# P2pRuntimeClientRoot.test.ts

Test file: [test/evm/P2pRuntimeClientRoot.test.ts](../../../../../../test/evm/P2pRuntimeClientRoot.test.ts)

## Overview

The suite exercises actual SDK-owned components and connections. Each declaration checks its named outcome through the production implementation; shared setup and fault controls live in fixtures.

## Tests

- `rejects readiness with the original startup host error`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P1
- `forwards host RPC timeout options and sendOne addresses unchanged`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P2
- `cleans owned inline executor endpoints after domain disposal fails`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P3
- `leaves the disposal deadline with the host`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P4
- `rejects an unknown host RPC delivery and serves the next invocation`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P5
- `keeps a timeout-free operation pending until domain cancellation`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P6
- `uses the ordinary thirty second request default`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P7
- `uses an explicit short timeout and ignores the later reply`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P8
- `keeps concurrent request results correlated`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P9
- `cleans up a synchronous post failure and serves another call`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P10
- `reports a post-ready host error and keeps later calls alive`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P11
- `receives ready before the deployComplete response`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P12
- `receives the dispose response before closing its connection`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P13
- `makes repeated disposal harmless and rejects later requests`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P14, UNIT-TEST-P2P-INSTANCE-1-AN3Y94.P3
- `releases application listeners and its owned logger after unexpected host closure`: UNIT-TEST-P2P-INSTANCE-1-AN3Y94.P1, REQ-RUNTIME-3-VQXW59.T1.P44
- `releases application listeners but preserves a supplied logger after unexpected host closure`: UNIT-TEST-P2P-INSTANCE-1-AN3Y94.P2, REQ-RUNTIME-3-VQXW59.T1.P45
- `preserves the caller logger after application setup fails`: UNIT-TEST-P2P-INSTANCE-1-AN3Y94.P4
