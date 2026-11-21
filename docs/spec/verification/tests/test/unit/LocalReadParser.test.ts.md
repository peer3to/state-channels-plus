# LocalReadParser.test.ts

Test file: [test/unit/LocalReadParser.test.ts](../../../../../../test/unit/LocalReadParser.test.ts)
Exercises: [LocalReadParser.ts](../../../../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/LocalReadParser.ts.md)

## Overview

The suite gives `parseLocalRead` JSON-RPC payloads as a provider sends them and checks which reads
the light client would answer itself. The oracle is the rule of
[`REQ-LC-1-JT5PKT`](../../../../specification/runtime/light-client.md#req-lc-1-jt5pkt) and
[`REQ-LC-2-PMY1VG`](../../../../specification/runtime/light-client.md#req-lc-2-pmy1vg): only a read at the
latest block, of the five methods, whose every field the local run honours, is answered locally;
a pending read, a read at any other block, a call with a gas limit or a fee field, and anything
malformed go to the node. For a call it also checks the decoded call (`parseCall`) and how each
outcome of the local run becomes the node's answer (`callAnswer`). The suite does not run a light
client: the live provider suite does.

## Tests

- `answers a call at the latest block locally, with or without a sender, value and tag`: UNIT-TEST-LC-1-CNNW3S.P1
- `answers a call that carries its data as input locally`: UNIT-TEST-LC-1-CNNW3S.P2
- `answers a returned call with its data, and a reverted one with the node's revert error and data`: UNIT-TEST-LC-1-CNNW3S.P15
- `leaves a call that failed locally without reverting to the node`: UNIT-TEST-LC-1-CNNW3S.P16
- `answers storage, balance, code and transaction count at the latest block locally`: UNIT-TEST-LC-1-CNNW3S.P3
- `leaves every pending read to the node`: UNIT-TEST-LC-1-CNNW3S.P4
- `leaves a read at any block other than the latest to the node`: UNIT-TEST-LC-1-CNNW3S.P5
- `leaves a call with a gas limit to the node`: UNIT-TEST-LC-1-CNNW3S.P6
- `leaves a call with a fee field to the node`: UNIT-TEST-LC-1-CNNW3S.P7
- `leaves a call with a field the local run does not honour to the node`: UNIT-TEST-LC-1-CNNW3S.P8
- `leaves a call with state overrides to the node`: UNIT-TEST-LC-1-CNNW3S.P9
- `leaves a creation, a call without a target, to the node`: UNIT-TEST-LC-1-CNNW3S.P10
- `leaves a call with a malformed field to the node`: UNIT-TEST-LC-1-CNNW3S.P11
- `leaves an account or storage read with a malformed parameter to the node`: UNIT-TEST-LC-1-CNNW3S.P12
- `leaves a read with more parameters than its method takes to the node`: UNIT-TEST-LC-1-CNNW3S.P13
- `leaves every other method to the node`: UNIT-TEST-LC-1-CNNW3S.P14
