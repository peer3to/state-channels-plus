# runGuards.test.ts

Test file: [test/rpc/guards/runGuards.test.ts](../../../../../../../test/rpc/guards/runGuards.test.ts)
Exercises: [runGuards.ts](../../../../../implementation/source/src/rpc/network/guards/runGuards.ts.md)

## Overview

The suite calls the production guard runner with concrete recording guards. It proves declaration
order, empty/all-pass success, first/middle/last short-circuit, one failure callback, and no later
checks after failure.

## Tests

- `returns false and stops when the first guard fails`: UNIT-TEST-RUN-GUARDS-1-TS1WHT.P1
- `returns true after every guard passes in declaration order`: UNIT-TEST-RUN-GUARDS-1-TS1WHT.P2
- `returns true for an empty guard list`: UNIT-TEST-RUN-GUARDS-1-TS1WHT.P3
- `calls one failure handler and skips later guards after a middle failure`: UNIT-TEST-RUN-GUARDS-1-TS1WHT.P4, REQ-RPC-7-9CBSHK.T1.P1, INTEGRATION-TEST-RPC-4-EXZ35F.P1
- `calls the last guard failure handler after earlier guards pass`: UNIT-TEST-RUN-GUARDS-1-TS1WHT.P5
