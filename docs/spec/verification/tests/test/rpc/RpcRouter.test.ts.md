# RpcRouter.test.ts

Test file: [test/rpc/RpcRouter.test.ts](../../../../../../test/rpc/RpcRouter.test.ts)

## Overview

The suite exercises actual SDK-owned components and connections. Each declaration checks its named outcome through the production implementation; shared setup and fault controls live in fixtures.

## Tests

- `resolves false without changing the result`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P1
- `resolves zero without changing the result`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P2
- `resolves null without changing the result`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P3
- `resolves undefined without changing the result`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P4
- `keeps concurrent out-of-order responses separate`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P5
- `returns sync endpoint failures and serves the next call`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P6
- `returns async endpoint failures and serves the next call`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P7
- `rejects a synchronous post failure and releases its entry`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P8
- `rejects an uncloneable argument without leaving pending work`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P9
- `uses the supplied timeout and cancels it after settlement`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P10
- `keeps a timeout-free call pending until its owner settles it`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P11
- `keeps reply settlement before remote error`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P12
- `keeps reply settlement before timeout`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P13
- `keeps reply settlement before owner rejection`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P14
- `keeps remote error settlement before reply`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P15
- `keeps remote error settlement before timeout`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P16
- `keeps remote error settlement before owner rejection`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P17
- `keeps timeout settlement before reply`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P18
- `keeps timeout settlement before remote error`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P19
- `keeps timeout settlement before owner rejection`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P20
- `keeps owner rejection settlement before reply`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P21
- `keeps owner rejection settlement before remote error`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P22
- `keeps owner rejection settlement before timeout`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P23
- `ignores unknown and duplicate responses`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P24
- `rejects all entries once and releases timers`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P25
- `registers before synchronous loopback delivery can reply`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P28
