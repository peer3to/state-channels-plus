# LightClientLocalRuns.test.ts

Test file: [test/lightClient/LightClientLocalRuns.test.ts](../../../../../../test/lightClient/LightClientLocalRuns.test.ts)
Exercises: [LightClient.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/LightClient.ts.md)

## Overview

The suite runs calls through the SDK's chain access over a peer3 node of its own whose answer depends
on how the EVM runs them: a sub-call that writes and reverts, transient storage, a contract created
before a sub-call reverts, a contract created in a frame that reverts, code over the size limit, the
addresses where later hardforks put precompiles, a call that carries value, and a list whose every slot
names the next. The oracle is the node's own answer to the same call. It runs only with `--lc-tests`.

## Tests

- `keeps nothing a reverted sub-call wrote, as the node runs it`: REQ-LC-1-JT5PKT.T1.P11
- `leaves a call that carries value to the node, which keeps its existential deposit back from a new account`: REQ-LC-2-PMY1VG.T1.P5
- `clears transient storage between calls`: REQ-LC-1-JT5PKT.T1.P12
- `runs a contract the call created, also after a sub-call reverted`: REQ-LC-1-JT5PKT.T1.P13
- `leaves no code where a frame that reverted created a contract`: REQ-LC-1-JT5PKT.T1.P14
- `refuses code over the size limit and runs only the precompiles the chain serves, as the node does`: REQ-LC-1-JT5PKT.T1.P15
- `gives up a read that keeps finding state missing, asks the node and logs it`: REQ-LC-3-W7RRHM.T1.P4
- `proves the slots a call needs, known together, in one request`: REQ-LC-9-KWXV43.T1.P8
