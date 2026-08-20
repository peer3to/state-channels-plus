# test/rpc/RpcHandler.test.ts — Test Report

> **Test file:** [test/rpc/RpcHandler.test.ts](../../../../../../test/rpc/RpcHandler.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [RpcHandler.ts](../../../../implementation/source/src/rpc/RpcHandler.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives `RpcHandler` inside real worker-hosted peers through a test-only RPC probe. The
probe selects live transports and calls the production delivery verbs; it does not replace the
P2P manager, profile manager, loopback transport, or request-correlation path. Three declarations
cover broadcast, loopback, address and transport overloads, a constructor-independent compatible
transport adapter, empty and partially unresolved fan-out, local missing-target rejection, and
options-only timeout forwarding. Oracles are exact receiver-side nonce counts, absence on excluded
peers, returned values, and rejection messages.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                       | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`RpcHandler > routes broadcast, compatible direct-transport, and loopback sends`](../../../../../../test/rpc/RpcHandler.test.ts#L14) (line 14)                        | [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P1`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p1), [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P2`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p2), [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P6`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p6)                                                                                                                                                                                                                                                                             |
| [`RpcHandler > routes transport and address lists while skipping empty and unresolved targets`](../../../../../../test/rpc/RpcHandler.test.ts#L42) (line 42)           | [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P3`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p3), [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P7`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p7), [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P8`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p8), [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P9`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p9), [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P10`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p10) |
| [`RpcHandler > routes compatible transport requests and rejects missing targets and loopback timeouts`](../../../../../../test/rpc/RpcHandler.test.ts#L115) (line 115) | [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P12`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p12), [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P13`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p13), [`UNIT-TEST-RPC-HANDLER-1-8BP2K8.P14`](../../../../implementation/source/src/rpc/RpcHandler.ts.md#unit-test-rpc-handler-1-8bp2k8.p14)                                                                                                                                                                                                                                                                       |
