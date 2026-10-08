# ARpcService.test.ts

Test file: [test/rpc/ARpcService.test.ts](../../../../../../test/rpc/ARpcService.test.ts)
Exercises: [ANetworkRpcService.ts](../../../../implementation/source/src/rpc/network/ANetworkRpcService.ts.md)

## Overview

The suite drives `ANetworkRpcService.runRPC` through a real worker-hosted custom RPC root and real SDK
transports. It covers guard and endpoint ordering, real loopback bypass, both delivery modes,
request-ID presence, method binding and shadowing, captured invocation, and one-attempt response-send
failure cleanup.

## Tests

A row lists only test IDs this test covers **in full**. Each test ID is assigned to exactly one
declaration.

- `settles a guarded request without resolving its endpoint`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P1, REQ-RPC-7-9CBSHK.T1.P2
- `applies the same guard consequence before existing or missing endpoint resolution`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P16, REQ-RPC-6-E60S4J.T1.P4
- `skips guards when the transport reports trusted`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P2
- `bypasses guards through the real loopback transport`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P17, REQ-RPC-7-9CBSHK.T1.P3, INTEGRATION-TEST-RPC-4-EXZ35F.P2
- `consumes a guarded one-way call without constructing or invoking its endpoint`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P18
- `returns false for a missing endpoint`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P3, REQ-RPC-6-E60S4J.T1.P5
- `rejects ANetworkRpcMethods and Object prototype names`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P4
- `invokes a method declared on the concrete class`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P8
- `invokes an endpoint inherited from an application methods class`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P9
- `invokes a function-valued own field`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P10
- `stops before Object.prototype when the methods object has no local RPC base`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P15
- `rejects accessors without invoking them`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P11
- `rejects non-function own properties`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P12
- `returns a request handler failure to the caller`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P5
- `runs guards for an untrusted network transport`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P6, REQ-RPC-7-9CBSHK.T1.P5
- `disconnects after a one-way handler rejection`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P7
- `returns false after a synchronous one-way handler throw`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P19
- `invokes the endpoint captured during authorization`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P13
- `invokes the captured endpoint for one-way delivery`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P20
- `uses the same endpoint rule for one-way delivery`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P14
- `allows an unguarded service over an untrusted transport`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P21
- `spreads params and binds this to the methods instance`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P22
- `lets a child accessor shadow an inherited endpoint without evaluating it`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P23
- `lets a child non-function shadow an inherited endpoint`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P24
- `treats an empty request id as a request`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P25
- `disconnects after one failed handler-response send without retrying`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P26, REQ-RPC-2-SZDTTM.T1.P20
- `disconnects after one failed guard-response send without retrying`: UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P27
