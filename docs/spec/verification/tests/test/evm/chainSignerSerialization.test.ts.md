# test/evm/chainSignerSerialization.test.ts — Test Report

> **Test file:** [test/evm/chainSignerSerialization.test.ts](../../../../../../test/evm/chainSignerSerialization.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [chainSignerSerialization.ts](../../../../implementation/source/src/evm/p2pRuntime/chainSignerSerialization.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite exercises the four `chainSignerSerialization` codecs directly against a live Hardhat
provider: transaction requests and responses are serialized for the runtime port and
reconstructed on the other side. The oracles compare field-by-field round-trips and provider
behavior of the reconstructed objects. The cases prove: a normalized request round-trips exactly
(signer resolved to its address, quantities hex/bigint-normalized, access list preserved); a
provider-backed response is reconstructed as a native ethers response (hash, nonce, value,
signature identical, `wait()` and `confirmations()` functional); a reconstructed response
supports explicit `replaceableTransaction` detection, surfacing `TRANSACTION_REPLACED` with the
replacement hash; and a request carrying `customData` — which cannot cross the runtime port — is
rejected with the documented error. The port transport itself and signing policy are out of
scope; only the serialization boundary is pinned here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                       | Covers                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`chain signer serialization > round-trips a normalized transaction request`](../../../../../../test/evm/chainSignerSerialization.test.ts#L13) (line 13)               | [`REQ-RUN-6-MTBT2H.T1.P1`](../../../../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-6-mtbt2h.t1.p1) |
| [`chain signer serialization > reconstructs a native provider-backed transaction response`](../../../../../../test/evm/chainSignerSerialization.test.ts#L47) (line 47) | —                                                                                                                               |
| [`chain signer serialization > allows explicit client-side replacement detection`](../../../../../../test/evm/chainSignerSerialization.test.ts#L68) (line 68)          | —                                                                                                                               |
| [`chain signer serialization > rejects fields that cannot cross the runtime port`](../../../../../../test/evm/chainSignerSerialization.test.ts#L116) (line 116)        | [`REQ-RUN-6-MTBT2H.T1.P4`](../../../../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-6-mtbt2h.t1.p4) |
