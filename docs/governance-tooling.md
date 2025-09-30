# Governance tooling for interest model tuning

To explore elasticity-driven rate adjustments safely, deploy the `RateGovernor` contract and hand
ownership of your interest models to it. The governor queues parameter changes behind a configurable
timelock so you can review every adjustment before it executes on-chain.

## Deploying the governor

```powershell
npx hardhat run scripts/deploy-governor.js --network localhost
```

The example script deploys a `RateGovernor` with a 12-hour minimum delay and prints the address. Make
sure to transfer ownership of any existing rate models to the governor:

```powershell
npx hardhat run scripts/transfer-model-ownership.js --network localhost --model <MODEL_ADDRESS> --governor <GOVERNOR_ADDRESS>
```

## Queuing parameter updates

Hardhat tasks provide a friendly interface for scheduling updates:

```powershell
# Queue a linear model APR change
npx hardhat governance:queue-linear-update \
  --network localhost \
  --governor <GOVERNOR_ADDRESS> \
  --model <LINEAR_MODEL_ADDRESS> \
  --base 0.03 \
  --slope 0.35 \
  --delay 7200

# Queue an adaptive model retune
npx hardhat governance:queue-timeweighted-update \
  --network localhost \
  --governor <GOVERNOR_ADDRESS> \
  --model <TIME_WEIGHTED_MODEL_ADDRESS> \
  --min 0.02 \
  --max 0.70 \
  --neutral 0.10 \
  --adjust 0.40 \
  --lower 0.30 \
  --upper 0.65
```

The CLI returns the proposal id and the earliest timestamp when the change becomes executable.

## Executing proposals

After the delay, execute the queued call:

```powershell
npx hardhat governance:execute --network localhost --governor <GOVERNOR_ADDRESS> --proposal <ID>
```

The transaction triggers the underlying `set*` function on the rate model. Failed executions revert
with the original error message so you can diagnose invalid parameter combinations.

## Extending the tooling

- Add more Hardhat tasks if you introduce new rate model types. You only need the ABI signature of
the setter function to encode the payload.
- Automate parameter derivation by piping utilisation metrics from analytics dashboards into the
tasks. For example, compute elasticity-driven targets off-chain, then queue the update on-chain.
- Combine with dashboards that monitor the governor’s proposal queue so risk teams can review
upcoming changes.
