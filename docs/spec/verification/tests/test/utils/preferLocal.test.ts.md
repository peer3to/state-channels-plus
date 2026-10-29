# preferLocal.test.ts

Test file: [preferLocal.test.ts](../../../../../../test/utils/preferLocal.test.ts)
Exercises: [localDiamond.ts.md](../../../../implementation/source/src/utils/localDiamond.ts.md)

## Overview

Calls `preferLocal(local, onChain, acceptLocal)` directly. Most cases use async stand-ins for the
local and chain reads and a boolean acceptance rule; the chain read counts its calls. The oracles
are the returned answer, the chain-read count, and, for a failing read, the exact rejection. The
synthetic revert uses the message the local signer surfaces for an executor revert
(`Local contract call failed: Error: Local EVM execution failed: …`, built from `LOCAL_EVM_EXECUTION_FAILED`),
and the failure cases also assert what `isLocalEvmExecutionFailure` answers for that error.

Two cases use a real `ContractExecutor` with a `LocalContractExecutorSigner`: a `MathStateMachine`
deployed with a transition budget above the executor's default call gas makes its
`stateTransition` revert inside the executor's EVM, and a signer call with no target fails before
the EVM. They show that a real revert carries the marker through the signer and that a real
non-revert failure does not. Which caller accepts which answer is out of scope (owned by the
calling components' suites).

## Tests

- `keeps an acceptable local answer without asking the chain`: UNIT-TEST-PREFER-LOCAL-1-XC95T6.P1
- `asks the chain when the local answer would make the node act`: UNIT-TEST-PREFER-LOCAL-1-XC95T6.P2
- `propagates a local EVM revert without asking the chain`: UNIT-TEST-PREFER-LOCAL-1-XC95T6.P11
- `propagates a local failure that is not a revert without asking the chain`: UNIT-TEST-PREFER-LOCAL-1-XC95T6.P4, UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P32
- `propagates the chain's rejection of a confirmation read`: UNIT-TEST-PREFER-LOCAL-1-XC95T6.P5
- `propagates a real local contract call revert in the executor without asking the chain`: UNIT-TEST-PREFER-LOCAL-1-XC95T6.P12
- `propagates a real local signer failure that is not a revert without asking the chain`: UNIT-TEST-PREFER-LOCAL-1-XC95T6.P8
- `propagates an acceptance-callback failure without asking the chain`: UNIT-TEST-PREFER-LOCAL-1-XC95T6.P10
