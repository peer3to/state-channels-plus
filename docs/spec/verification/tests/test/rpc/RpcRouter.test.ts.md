# test/rpc/RpcRouter.test.ts — Test Report

> **Test file:** [test/rpc/RpcRouter.test.ts](../../../../../../test/rpc/RpcRouter.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [RpcRouter](../../../../implementation/source/src/rpc/RpcRouter.ts.md), [RpcHandler](../../../../implementation/source/src/rpc/RpcHandler.ts.md), [MessagePortTransport](../../../../implementation/source/src/transport/MessagePortTransport.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite links two real `RpcRouter`s over a Node `MessageChannel`, each serving a probe root and
holding a typed endpoint for the other, and drives the request/response core through that pair:
results and restored errors, the router's own timeout bound and the `null` one, closure settling
only the closed transport's requests, unknown names answered rather than disconnected, one-way
delivery, the inbound wrapper, structured-clone values, and how a targetless delivery resolves —
to the single line while it is up, ambiguously refused with two, dropped for a one-way call and
refused for a request once the last line is gone. No mocks; the far end is a real root behind a
real port.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                            | Covers                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`RpcRouter > resolves a request with the far handler's return value`](../../../../../../test/rpc/RpcRouter.test.ts#L26) (line 26)                          | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P1`](../../../../implementation/source/src/rpc/RpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p1), [`INTEGRATION-TEST-RPC-7-P5RCGJ.P1`](../../../../implementation/views/architecture/sdk/rpc/README.md#integration-test-rpc-7-p5rcgj.p1) |
| [`RpcRouter > rejects with the far error, its name, revert data and code restored`](../../../../../../test/rpc/RpcRouter.test.ts#L34) (line 34)             | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P2`](../../../../implementation/source/src/rpc/RpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p2), [`INTEGRATION-TEST-RPC-7-P5RCGJ.P2`](../../../../implementation/views/architecture/sdk/rpc/README.md#integration-test-rpc-7-p5rcgj.p2) |
| [`RpcRouter > times out with the router's default and clears the pending entry`](../../../../../../test/rpc/RpcRouter.test.ts#L51) (line 51)                | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P3`](../../../../implementation/source/src/rpc/RpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p3)                                                                                                                                         |
| [`RpcRouter > a null timeout outlives a handler slower than the default`](../../../../../../test/rpc/RpcRouter.test.ts#L72) (line 72)                       | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P4`](../../../../implementation/source/src/rpc/RpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p4)                                                                                                                                         |
| [`RpcRouter > closing a transport rejects its pending requests and nothing else`](../../../../../../test/rpc/RpcRouter.test.ts#L84) (line 84)               | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P5`](../../../../implementation/source/src/rpc/RpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p5), [`INTEGRATION-TEST-RPC-7-P5RCGJ.P4`](../../../../implementation/views/architecture/sdk/rpc/README.md#integration-test-rpc-7-p5rcgj.p4) |
| [`RpcRouter > refuses a request on a closed transport at once instead of timing out`](../../../../../../test/rpc/RpcRouter.test.ts#L107) (line 107)         | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P12`](../../../../implementation/source/src/rpc/RpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p12)                                                                                                                                       |
| [`RpcRouter > answers an unknown service or method with an error and keeps the line`](../../../../../../test/rpc/RpcRouter.test.ts#L127) (line 127)         | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P6`](../../../../implementation/source/src/rpc/RpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p6), [`INTEGRATION-TEST-RPC-7-P5RCGJ.P3`](../../../../implementation/views/architecture/sdk/rpc/README.md#integration-test-rpc-7-p5rcgj.p3) |
| [`RpcRouter > delivers a one-way call and logs a throwing one-way handler without closing`](../../../../../../test/rpc/RpcRouter.test.ts#L158) (line 158)   | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P7`](../../../../implementation/source/src/rpc/RpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p7)                                                                                                                                         |
| [`RpcRouter > hands a late logger to every service on the root and skips non-service fields`](../../../../../../test/rpc/RpcRouter.test.ts#L180) (line 180) | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P13`](../../../../implementation/source/src/rpc/RpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p13)                                                                                                                                       |
| [`RpcRouter > runs every inbound dispatch inside the wrapper`](../../../../../../test/rpc/RpcRouter.test.ts#L199) (line 199)                                | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P8`](../../../../implementation/source/src/rpc/RpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p8)                                                                                                                                         |
| [`RpcRouter > a bigint and a byte array cross the line unchanged`](../../../../../../test/rpc/RpcRouter.test.ts#L221) (line 221)                            | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P9`](../../../../implementation/source/src/rpc/RpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p9)                                                                                                                                         |
| [`RpcRouter > request() with no target uses the router's only transport`](../../../../../../test/rpc/RpcRouter.test.ts#L232) (line 232)                     | [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P17`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p17)                                                                                                                                              |
| [`RpcRouter > request() with no target and two transports rejects`](../../../../../../test/rpc/RpcRouter.test.ts#L243) (line 243)                           | [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P18`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p18)                                                                                                                                              |
| [`RpcRouter > a targetless send on a closed line drops and a request refuses`](../../../../../../test/rpc/RpcRouter.test.ts#L269) (line 269)                | [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P19`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p19)                                                                                                                                              |
