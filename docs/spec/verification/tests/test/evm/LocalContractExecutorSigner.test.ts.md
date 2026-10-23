# LocalContractExecutorSigner.test.ts

Test file: [test/evm/LocalContractExecutorSigner.test.ts](../../../../../../test/evm/LocalContractExecutorSigner.test.ts)
Exercises: [LocalContractExecutorSigner](../../../../implementation/source/src/evm/signer/LocalContractExecutorSigner.ts.md)

## Overview

Verifies that a local transaction runs on a real local EVM through a signer with no provider, so
any chain read would fail it.

## Tests

- `deploys through the local EVM with no chain request, numbering its local transactions`: UNIT-TEST-LOCAL-CONTRACT-EXECUTOR-SIGNER-1-6BS5C1.P1
