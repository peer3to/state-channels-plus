# DeployUtils.test.ts

Test file: [test/unit/DeployUtils.test.ts](../../../../../../test/unit/DeployUtils.test.ts)
Exercises: [DeployUtils.ts](../../../../implementation/source/src/utils/node/DeployUtils.ts.md)

## Overview

The suite deploys real facets through the node `DeployUtils.deployAsync` with the slot deployer of a harness session, so each deploy reaches the test chain's node (Hardhat or the peer3 dev node), into temporary contracts files. Oracles are the mined deploy, its gas limit against `MAX_TX_GAS`, the code at the deployed address, and the exact contracts-file content.

## Tests

- `deploys the largest facet within the per-transaction gas cap and writes its address and ABI to a new contracts file`: UNIT-TEST-DEPLOY-UTILS-1-YZSHSA.P1
- `keeps the entries of an existing contracts file beside the new deploy`: UNIT-TEST-DEPLOY-UTILS-1-YZSHSA.P2
