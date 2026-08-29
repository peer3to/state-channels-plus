# test/rpc/PortRpcRouter.test.ts — Test Report

> **Test file:** [test/rpc/PortRpcRouter.test.ts](../../../../../../test/rpc/PortRpcRouter.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [PortRpcRouter](../../../../implementation/source/src/rpc/PortRpcRouter.ts.md), [ARpcRouter](../../../../implementation/source/src/rpc/ARpcRouter.ts.md), [MessagePortTransport](../../../../implementation/source/src/transport/MessagePortTransport.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite links two real `PortRpcRouter`s over a Node `MessageChannel`, each serving a probe root
and holding a typed endpoint for the other, and drives the request/response core through that
pair: results and restored errors, the default and the `null` timeout, closure settling only the
closed transport's requests, unknown names answered rather than disconnected, one-way delivery,
the inbound wrapper, structured-clone values, the slow-request log, and the hold-until-released
gate the runtime host relies on. No mocks; the far end is a real root behind a real port.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                  | Covers                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`PortRpcRouter > resolves a request with the far handler's return value`](../../../../../../test/rpc/PortRpcRouter.test.ts#L22) (line 22)                        | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P1`](../../../../implementation/source/src/rpc/PortRpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p1), [`INTEGRATION-TEST-RPC-7-P5RCGJ.P1`](../../../../implementation/views/architecture/sdk/rpc/README.md#integration-test-rpc-7-p5rcgj.p1) |
| [`PortRpcRouter > rejects with the far error, its name, revert data and code restored`](../../../../../../test/rpc/PortRpcRouter.test.ts#L31) (line 31)           | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P2`](../../../../implementation/source/src/rpc/PortRpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p2), [`INTEGRATION-TEST-RPC-7-P5RCGJ.P2`](../../../../implementation/views/architecture/sdk/rpc/README.md#integration-test-rpc-7-p5rcgj.p2) |
| [`PortRpcRouter > times out with the router's default and clears the pending entry`](../../../../../../test/rpc/PortRpcRouter.test.ts#L48) (line 48)              | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P3`](../../../../implementation/source/src/rpc/PortRpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p3)                                                                                                                                         |
| [`PortRpcRouter > a null timeout outlives a handler slower than the default`](../../../../../../test/rpc/PortRpcRouter.test.ts#L67) (line 67)                     | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P4`](../../../../implementation/source/src/rpc/PortRpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p4)                                                                                                                                         |
| [`PortRpcRouter > closing a transport rejects its pending requests and nothing else`](../../../../../../test/rpc/PortRpcRouter.test.ts#L77) (line 77)             | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P5`](../../../../implementation/source/src/rpc/PortRpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p5), [`INTEGRATION-TEST-RPC-7-P5RCGJ.P4`](../../../../implementation/views/architecture/sdk/rpc/README.md#integration-test-rpc-7-p5rcgj.p4) |
| [`PortRpcRouter > answers an unknown service or method with an error and keeps the line`](../../../../../../test/rpc/PortRpcRouter.test.ts#L102) (line 102)       | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P6`](../../../../implementation/source/src/rpc/PortRpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p6), [`INTEGRATION-TEST-RPC-7-P5RCGJ.P3`](../../../../implementation/views/architecture/sdk/rpc/README.md#integration-test-rpc-7-p5rcgj.p3) |
| [`PortRpcRouter > delivers a one-way call and logs a throwing one-way handler without closing`](../../../../../../test/rpc/PortRpcRouter.test.ts#L137) (line 137) | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P7`](../../../../implementation/source/src/rpc/PortRpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p7)                                                                                                                                         |
| [`PortRpcRouter > runs every inbound dispatch inside the wrapper`](../../../../../../test/rpc/PortRpcRouter.test.ts#L159) (line 159)                              | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P8`](../../../../implementation/source/src/rpc/PortRpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p8)                                                                                                                                         |
| [`PortRpcRouter > a bigint and a byte array cross the line unchanged`](../../../../../../test/rpc/PortRpcRouter.test.ts#L181) (line 181)                          | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P9`](../../../../implementation/source/src/rpc/PortRpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p9)                                                                                                                                         |
| [`PortRpcRouter > logs a request that settles slower than the threshold`](../../../../../../test/rpc/PortRpcRouter.test.ts#L192) (line 192)                       | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P10`](../../../../implementation/source/src/rpc/PortRpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p10)                                                                                                                                       |
| [`PortRpcRouter > holds inbound requests until released and dispatches them in order`](../../../../../../test/rpc/PortRpcRouter.test.ts#L207) (line 207)          | [`UNIT-TEST-PORT-RPC-ROUTER-1-8J6MZG.P11`](../../../../implementation/source/src/rpc/PortRpcRouter.ts.md#unit-test-port-rpc-router-1-8j6mzg.p11)                                                                                                                                       |
