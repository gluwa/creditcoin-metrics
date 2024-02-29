// src/index.js
import express, { Express } from "express";
import dotenv from "dotenv";
import client from "prom-client";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { AccountId } from "@polkadot/types/interfaces";

dotenv.config();
const register = new client.Registry();

const app: Express = express();
const port = process.env.PORT || 3000;
const wsUrl = process.env.CREDITCOIN_API_URL || "ws://127.0.0.1:9944";
const INTERVAL_OF_SYNC = 30000;

const NOMINATOR_POOL_LABELS = [
  "chain",
  "nominator_pool_id",
  "nominator_pool_name",
];

const validatorsGuage = new client.Gauge({
  name: "ccm_validator_count",
  help: "this metric holds all validators",
  labelNames: ["chain", "validator_address", "status"],
});

const poolNominatorsGuage = new client.Gauge({
  name: "ccm_pool_nominator_count",
  help: "this metric olds the number of nominators inside a nominator pool",
  labelNames: NOMINATOR_POOL_LABELS,
});

register.registerMetric(poolNominatorsGuage);
register.registerMetric(validatorsGuage);

const provider = new WsProvider(wsUrl);

setInterval(async () => {
  const api = await ApiPromise.create({ provider, noInitWarn: true });
  await cryptoWaitReady();

  let activeValidators: string[] = [];
  let nextElected: AccountId[] = [];
  let waitingValidators: string[] = [];
  if (api.query.session) {
    const response = await api.query.session.validators();
    activeValidators = response.toJSON() as string[];
  }
  if (api.derive.staking) {
    nextElected = await api.derive.staking.nextElected();
  }

  nextElected.map((validator) => {
    if (!activeValidators.includes(validator.toString())) {
      waitingValidators.push(validator.toString());
    }
  });
}, INTERVAL_OF_SYNC);

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
