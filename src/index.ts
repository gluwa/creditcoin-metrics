// src/index.js
import express, { Express } from "express";
import dotenv from "dotenv";
import client from "prom-client";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { AccountId } from "@polkadot/types/interfaces";
import BigNumber from "bignumber.js";

dotenv.config();
const register = new client.Registry();

const app: Express = express();
const port = process.env.PORT || 3000;
const wsUrl = process.env.CREDITCOIN_API_URL || "ws://127.0.0.1:9944";
const chainName = process.env.CHAIN_NAME || "creditcoin_local";
const INTERVAL_OF_SYNC = 30000;
const gluwaValidators = process.env.GLUWA_VALIDATORS?.split(",") ?? [];

const activeValidatorCountGuage = new client.Gauge({
  name: "ccm_active_validator_count",
  help: "this metric holds the number of active validators",
  labelNames: ["chain"],
});

const waitingValidatorCountGuage = new client.Gauge({
  name: "ccm_waiting_validator_count",
  help: "this metric holds the number of waiting validators",
  labelNames: ["chain"],
});

const activeNominatorCountGuage = new client.Gauge({
  name: "ccm_active_nominator_count",
  help: "this metric holds the number of active nominators",
  labelNames: ["chain"],
});

const totalStakedGauge = new client.Gauge({
  name: "ccm_total_staked_percentage",
  help: "this metric holds the percentage of tokens staked in the network",
  labelNames: ["chain"],
});

const missingPrevoteValidatorsGauge = new client.Gauge({
  name: "ccm_missing_prevote_gluwa_validator_count",
  help: "this metric holds the number of Gluwa validators that misses prevote",
  labelNames: ["chain"],
});

register.registerMetric(activeNominatorCountGuage);
register.registerMetric(activeValidatorCountGuage);
register.registerMetric(waitingValidatorCountGuage);
register.registerMetric(totalStakedGauge);
register.registerMetric(missingPrevoteValidatorsGauge);

const provider = new WsProvider(wsUrl);
let api: any = null;

let previousActiveValidatorCount: number;
let previousWaitingValidatorCount: number;
let previousNominatorCount: number;
let previousTotalStaked: number;
let previousMissedPrevoteValidators: number;

const getValidatorsCount = async (
  api: ApiPromise
): Promise<[number, number]> => {
  try {
    let activeValidators: string[] = (
      await api.query.session.validators()
    ).toJSON() as string[];
    let nextElected: AccountId[] = await api.derive.staking.nextElected();

    let waitingValidatorsCount = 0;
    nextElected.forEach((validator) => {
      if (!activeValidators.includes(validator.toString())) {
        waitingValidatorsCount++;
      }
    });

    return [activeValidators.length, waitingValidatorsCount];
  } catch (e) {
    return [previousActiveValidatorCount, previousWaitingValidatorCount];
  }
};

const updateValidatorGauge = async (api: ApiPromise) => {
  const [currentActiveValidatorCount, currentWaitingValidatorCount] =
    await getValidatorsCount(api);

  if (previousActiveValidatorCount !== currentActiveValidatorCount) {
    activeValidatorCountGuage
      .labels(chainName)
      .set(currentActiveValidatorCount);
    previousActiveValidatorCount = currentActiveValidatorCount;
  }

  if (previousWaitingValidatorCount !== currentWaitingValidatorCount) {
    waitingValidatorCountGuage
      .labels(chainName)
      .set(currentWaitingValidatorCount);
    previousWaitingValidatorCount = currentWaitingValidatorCount;
  }
};

const getNominatorsCount = async (api: ApiPromise): Promise<number> => {
  try {
    const era = (await api.query.staking.activeEra()).toJSON() as {
      index: string;
      start: string;
    };

    const activeEra = new BigNumber(era.index);

    const exposures = await api.query.staking.erasStakers.entries(
      activeEra.toString()
    );

    const nominators = new Set();

    exposures.map(([, v]: any) => {
      const { others } = v.toHuman();
      others.forEach(({ who }: any) => {
        nominators.add(who);
      });
    });

    return nominators.size;
  } catch (e) {
    return previousNominatorCount;
  }
};

const updateNominatorGauge = async (api: ApiPromise) => {
  const nominatorCount = await getNominatorsCount(api);

  if (previousNominatorCount !== nominatorCount) {
    activeNominatorCountGuage.labels(chainName).set(nominatorCount);
    previousNominatorCount = nominatorCount;
  }
};

const getTotalStakedPercentage = async (api: ApiPromise): Promise<number> => {
  try {
    const era = (await api.query.staking.activeEra()).toJSON() as {
      index: string;
      start: string;
    };

    const previousEra = new BigNumber(era.index).minus(1);

    const lastToalStaked = new BigNumber(
      (
        await api.query.staking.erasTotalStake(previousEra.toString())
      ).toString()
    );
    const totalIssuance = new BigNumber(
      (await api.query.balances.totalIssuance()).toString()
    );

    const BIGNUMBER_MILLION = new BigNumber(1_000_000);
    const stakedFraction =
      lastToalStaked.isZero() || totalIssuance.isZero()
        ? 0
        : lastToalStaked
            .multipliedBy(BIGNUMBER_MILLION)
            .dividedBy(totalIssuance)
            .toNumber() / BIGNUMBER_MILLION.toNumber();

    return stakedFraction * 100.0;
  } catch (e) {
    console.error(e);
    return previousTotalStaked;
  }
};

const updateTotalStakedGauge = async (api: ApiPromise) => {
  const totalStaked = await getTotalStakedPercentage(api);
  if (previousTotalStaked !== totalStaked) {
    totalStakedGauge.labels(chainName).set(totalStaked);
    previousTotalStaked = totalStaked;
  }
};

const getMissedPrevoteValidators = async (api: ApiPromise): Promise<number> => {
  try {
    const roundState = await api.rpc.grandpa.roundState();
    const missingValidators =
      roundState.best.prevotes.missing.toJSON() as string[];

    return missingValidators.filter((validator) =>
      gluwaValidators.includes(validator)
    ).length;
  } catch (e) {
    console.error(e);
    return previousMissedPrevoteValidators;
  }
};

const updateMissedPrevoteValidatorsGauge = async (api: ApiPromise) => {
  const missedPrevoteValidators = await getMissedPrevoteValidators(api);
  if (previousMissedPrevoteValidators !== missedPrevoteValidators) {
    missingPrevoteValidatorsGauge
      .labels(chainName)
      .set(missedPrevoteValidators);
    previousMissedPrevoteValidators = missedPrevoteValidators;
  }
};

const updateGauge = async () => {
  if (!api) return;
  await cryptoWaitReady();

  await updateValidatorGauge(api);
  await updateNominatorGauge(api);
  await updateTotalStakedGauge(api);
  await updateMissedPrevoteValidatorsGauge(api);
};

const start = async () => {
  api = await ApiPromise.create({ provider, noInitWarn: true });

  setInterval(async () => {
    await updateGauge();
  }, INTERVAL_OF_SYNC);
};

start();

app.get("/metrics", async (req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.send(await register.metrics());
});

app.get("/health", async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  res.status(200).send(
    JSON.stringify({
      health: "Healthy",
    })
  );
});

app.post("/trigger-error", async (req, res) => {
  process.exit(1);
});

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
