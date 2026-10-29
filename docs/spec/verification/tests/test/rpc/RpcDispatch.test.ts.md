# RpcDispatch.test.ts

Test file: [test/rpc/RpcDispatch.test.ts](../../../../../../test/rpc/RpcDispatch.test.ts)

## Overview

The suite exercises actual SDK-owned components and connections. Each declaration checks its named outcome through the production implementation; shared setup and fault controls live in fixtures.

## Tests

- `invokes an own endpoint`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P1
- `invokes an inherited endpoint`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P2
- `rejects a getter shadow without executing it`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P3
- `rejects a non-function shadow`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P4
- `rejects a missing service`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P5
- `rejects a missing method`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P6
- `rejects a constructor`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P7
- `rejects an Object base method`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P8
- `rejects service helpers`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P9
- `invokes the captured callable`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P10
- `preserves positional and optional arguments`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P11
- `supports empty arguments and undefined results`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P12
- `returns sync endpoint errors`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P13
- `returns async endpoint errors`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P14
- `acknowledges void only after the endpoint completes`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P15
- `sends without a response or pending entry`: UNIT-TEST-RPC-DISPATCH-1-5WY71T.P16
- `awaits request dispatch while another RPC releases the endpoint`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P26
- `awaits send dispatch without blocking another incoming RPC`: UNIT-TEST-ARPC-ROUTER-1-459EX2.P27
