# MirrorLocalExecution.test.ts

Test file: [test/evm/MirrorLocalExecution.test.ts](../../../../../../test/evm/MirrorLocalExecution.test.ts)
Exercises: [LocalExecutionPolicy.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/mirror/LocalExecutionPolicy.ts.md)

## Overview

Two direct calls to the policy functions with byte and address tables, and five cases that deploy PolkaVM-like code, a chain precompile stand-in and standard precompile callers on the anvil test chain and compare what the mirrored provider sends to the node and what it answers.

## Tests

- `recognises PolkaVM program blobs by their magic and nothing else`: UNIT-TEST-RPCMIRROR-LOCAL-POLICY-1-B53976.P1
- `sends the chain's builtin and external precompile ranges to the node and runs the standard ones locally`: UNIT-TEST-RPCMIRROR-LOCAL-POLICY-1-B53976.P2
- `sends a call to PolkaVM code to the node whole`: REQ-RPCMIRROR-2-1P38E2.T1.P4
- `still answers eth_getCode of PolkaVM code and runs the registered precompile that stands in for it`: REQ-RPCMIRROR-1-XQNZ4J.T1.P8, REQ-RPCMIRROR-2-1P38E2.T1.P5
- `sends a call that reaches a chain precompile the local EVM does not reproduce to the node whole`: REQ-RPCMIRROR-2-1P38E2.T1.P6
- `runs a call that reaches a standard precompile locally`: REQ-RPCMIRROR-2-1P38E2.T1.P7
- `sends a direct call to the point evaluation address to the node`: REQ-RPCMIRROR-2-1P38E2.T1.P8
