# Creditcoin Telemetry Exporter

## Purpose

This repository contains the application code and infrastructure code for telemetry exporter.
It is made up of a scrapper which scrapes specified data from https://telemetry.polkadot.io,
then it creates metrics from the strramed data.

## How to Use

### Local

Install application dependencies

```
npm install
```

Start application and check check your application on http://localhost:8080/metrics

```
node index.js
```

Run Prometheus: Ensure you have Docker installed and running.
Prometheus will be running on http://localhost:9090.

```
docker-compose up
```

### Deploy to Azure Container Instances

```
az deployment group create --template-file exporter.bicep -g ccsubstrate-common --parameters location=koreacentral
```
