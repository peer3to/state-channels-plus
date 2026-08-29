# test/evm/P2pRuntimeClient.test.ts — Test Report

> **Test file:** [test/evm/P2pRuntimeClient.test.ts](../../../../../../test/evm/P2pRuntimeClient.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [P2pRuntimeClient](../../../../implementation/source/src/evm/p2pRuntime/P2pRuntimeClient.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives a real `P2pRuntimeClient` against a fake host that speaks the runtime port's
real envelope — a `PortRpcRouter` serving a `lifecycle` service and pushing `runtimeEvents` — so
the client's own decisions are observed through its public surface: what it does with the WebRTC
bridge candidate depending on the `deployComplete` reply, and how a host error or a failed
`deployComplete` settles `ready` with the host's error, its name and its revert data intact.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                               | Covers                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`P2pRuntimeClient > keeps the bridge candidate when the host registered the bridge`](../../../../../../test/evm/P2pRuntimeClient.test.ts#L37) (line 37)       | [`UNIT-TEST-P2P-RUNTIME-CLIENT-1-W13T15.P1`](../../../../implementation/source/src/evm/p2pRuntime/P2pRuntimeClient.ts.md#unit-test-p2p-runtime-client-1-w13t15.p1) |
| [`P2pRuntimeClient > closes the bridge candidate when the host negotiates WebRTC itself`](../../../../../../test/evm/P2pRuntimeClient.test.ts#L63) (line 63)   | [`UNIT-TEST-P2P-RUNTIME-CLIENT-1-W13T15.P2`](../../../../implementation/source/src/evm/p2pRuntime/P2pRuntimeClient.ts.md#unit-test-p2p-runtime-client-1-w13t15.p2) |
| [`P2pRuntimeClient > a host error pushed before deployComplete rejects ready with it`](../../../../../../test/evm/P2pRuntimeClient.test.ts#L93) (line 93)      | [`UNIT-TEST-P2P-RUNTIME-CLIENT-1-W13T15.P3`](../../../../implementation/source/src/evm/p2pRuntime/P2pRuntimeClient.ts.md#unit-test-p2p-runtime-client-1-w13t15.p3) |
| [`P2pRuntimeClient > a failed deployComplete rejects with the host's error and its data`](../../../../../../test/evm/P2pRuntimeClient.test.ts#L115) (line 115) | [`UNIT-TEST-P2P-RUNTIME-CLIENT-1-W13T15.P4`](../../../../implementation/source/src/evm/p2pRuntime/P2pRuntimeClient.ts.md#unit-test-p2p-runtime-client-1-w13t15.p4) |
