# E2E-ApplicationHostRoot.test.ts

Test file: [test/e2e/E2E-ApplicationHostRoot.test.ts](../../../../../../test/e2e/E2E-ApplicationHostRoot.test.ts)
Exercises: [P2pRuntimeHostRoot.ts.md](../../../../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md)

## Overview

Two real harness peers run the test application's `ProbeHostRoot` and its `ProbeRpc` network root
through the harness `hostRootManifest` and `customRpcManifest` options, open a channel, and connect. The first case calls `probe.echo` from each
peer's client over its typed host connection and asserts each reply carries that peer's own signer
address and each runtime recorded only its own client's value. The second case has one peer send a
real network request naming `probe.echo` to the other over their authenticated transport (the
harness `byzantine.requestRawRpc` control). The receiver finds no network service of that name,
refuses the dispatch and disconnects the caller instead of replying, so the request settles with the
peer-disconnected error; the receiver blacklists the caller, and its probe recorded no call.

## Tests

- `a peer's client calls its host root service`: REQ-RPC-9-8FFE6S.T1.P13
- `a peer's network call to the service finds no network service and has no effect`: REQ-RPC-9-8FFE6S.T1.P14
