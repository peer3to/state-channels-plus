# RootErrorService.test.ts

Test file: [RootErrorService.test.ts](../../../../../../test/rpc/RootErrorService.test.ts)
Exercises: [RootErrorService](../../../../implementation/source/src/rpc/internal/services/errors/RootErrorService.ts.md)

## Overview

Exercises upward error reporting across actual SDK and executor connections in both SDK placements. Request failures remain separate; a parent cannot report an error as if it were a child.

## Tests

- `RootErrorService > rejects an error report from a parent without closing the connection`: UNIT-TEST-ROOT-ERROR-1-0N4XM4.P5
- `RootErrorService > forwards a child error once through an inline SDK and keeps both roots usable`: UNIT-TEST-ROOT-ERROR-1-0N4XM4.P1
- `RootErrorService > forwards a child error once through a worker SDK and keeps both roots usable`: UNIT-TEST-ROOT-ERROR-1-0N4XM4.P2
- `RootErrorService > returns an inline child request failure without an autonomous report`: UNIT-TEST-ROOT-ERROR-1-0N4XM4.P3
- `RootErrorService > returns a worker child request failure without an autonomous report`: UNIT-TEST-ROOT-ERROR-1-0N4XM4.P4
- `rejects unknown host RPC services and unsupported delivery selectors`: UNIT-TEST-HOST-RPC-1-X1QFZA.P1
- `surfaces a client host error as an unhandled rejection when no listener exists`: UNIT-TEST-SDK-CLIENT-ROOT-1-93DC96.P15
- `reports a fire-and-forget endpoint failure once without closing the root`: UNIT-TEST-ROOT-ERROR-1-0N4XM4.P10
- `rejects readiness when a child reports an error before ready`: UNIT-TEST-ROOT-ERROR-1-0N4XM4.P8
- `rejects readiness through the startupFailed wire endpoint`: UNIT-TEST-ROOT-ERROR-1-0N4XM4.P9
