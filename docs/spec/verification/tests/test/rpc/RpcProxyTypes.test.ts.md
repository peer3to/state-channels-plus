# test/rpc/RpcProxyTypes.test.ts — Test Report

> **Test file:** [test/rpc/RpcProxyTypes.test.ts](../../../../../../test/rpc/RpcProxyTypes.test.ts) > **Status:** Authored — engineer verification pending.

## Overview

Compile-time checks independently reject concrete roots missing startup or disposal.

The suite exercises actual SDK-owned components and connections. Each declaration checks its named outcome through the production implementation; shared setup and fault controls live in fixtures.

## Tests and covered test IDs

| Test                                                                                                                                                          | Covers                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`RpcProxyTypes > reads a mutable peer service context when the captured method is called`](../../../../../../test/rpc/RpcProxyTypes.test.ts#L13) (line 13)   | [`UNIT-TEST-RPC-PROXY-1-R74W81.P1`](../../../../implementation/source/src/rpc/createRpcProxy.ts.md#unit-test-rpc-proxy-1-r74w81)                                                                                                                                                                             |
| [`RpcProxyTypes > preserves bound arguments results void acknowledgement and explicit sends`](../../../../../../test/rpc/RpcProxyTypes.test.ts#L16) (line 16) | [`UNIT-TEST-RPC-PROXY-1-R74W81.P2`](../../../../implementation/source/src/rpc/createRpcProxy.ts.md#unit-test-rpc-proxy-1-r74w81)                                                                                                                                                                             |
| [`RpcProxyTypes > keeps runtime proxy roots non-thenable`](../../../../../../test/rpc/RpcProxyTypes.test.ts#L33) (line 33)                                    | [`UNIT-TEST-RPC-PROXY-1-R74W81.P3`](../../../../implementation/source/src/rpc/createRpcProxy.ts.md#unit-test-rpc-proxy-1-r74w81)                                                                                                                                                                             |
| [`rejects unrelated roots and cross-category router transport and service types`](../../../../../../test/rpc/RpcProxyTypes.test.ts#L40) (line 40)             | [`UNIT-TEST-RUNTIME-SERVICE-1-WH4SSY.P3`](../../../../implementation/source/src/rpc/internal/AInternalRpcRoot.ts.md#unit-test-runtime-service-1-wh4ssy), [`UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P6`](../../../../implementation/source/src/rpc/internal/AInternalRpcRoot.ts.md#unit-test-root-disposal-1-nms66w) |

The bound-type fixture also checks concrete remote handles, assignment to the common-root handle type, and rejection of domain services absent from that type.
