# ContractExecutor.test.ts

Test file: [test/evm/ContractExecutor.test.ts](../../../../../../test/evm/ContractExecutor.test.ts)
Exercises: [ContractExecutor.ts](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md)

## Overview

Covers inline execution, dedicated Node workers, supplied and runtime clocks, constructor time, simulation rollback, and the factory before Clock initialization.

## Tests

- `should successfully execute a call to get a value`: none
- `should successfully execute a call to set a value`: none
- `should successfully set state using bytes`: none
- `should return RPC-style logs`: none
- `should simulate a mutating call without persisting it`: none
- `should not expand the underlying EVM DB on simulated mutating calls`: none
- `should expand the underlying EVM DB on canonical mutating calls`: none
- `should make simulations wait while a canonical call holds the mutex`: none
- `should simulate from the committed state after a canonical call releases`: none
- `should serialize detached simulations`: none
- `should serialize many detached canonical increments and simulations without corrupting state`: REQ-RUNTIME-2-KBXKTG.T1.P1
- `should serialize canonical detached calls before entering evm.runCall`: none
- `should throw an error for invalid function calls`: none
- `should properly decode Solidity revert errors`: none
- `a bare executor stamps exactly its clock source's value`: UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P1
- `the runtime inline executor observes the adjusted Clock and advances`: REQ-TIME-5-S9NQXK.T1.P1
- `the runtime dedicated executor observes the adjusted Clock and advances`: REQ-TIME-5-S9NQXK.T1.P2, REQ-RUNTIME-6-6F4SSM.T1.P1
- `deployment records the supplied timestamp in constructor storage`: UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P2
- `simulation observes the supplied timestamp without persisting its storage write`: UNIT-TEST-CONTRACT-EXECUTOR-1-JHG6KJ.P3
- `reads a changed shared Clock after inline executor construction`: none
