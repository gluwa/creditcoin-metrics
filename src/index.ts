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

register.registerMetric(activeNominatorCountGuage);
register.registerMetric(activeValidatorCountGuage);
register.registerMetric(waitingValidatorCountGuage);
register.registerMetric(totalStakedGauge);

const provider = new WsProvider(wsUrl);

let previousActiveValidatorCount: number;
let previousWaitingValidatorCount: number;
let previousNominatorCount: number;
let previousTotalStaked: number;

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

const updateGauge = async () => {
  const api = await ApiPromise.create({ provider, noInitWarn: true });
  await cryptoWaitReady();

  await updateValidatorGauge(api);
  await updateNominatorGauge(api);
  await updateTotalStakedGauge(api);
};

setInterval(async () => {
  await updateGauge();
}, INTERVAL_OF_SYNC);

// updateGauge();

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

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
