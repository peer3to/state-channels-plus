# test/evm/chainSignerSerialization.test.ts — Test Report

> **Test file:** [test/evm/chainSignerSerialization.test.ts](../../../../../../test/evm/chainSignerSerialization.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [chainSignerSerialization.ts](../../../../implementation/source/src/rpc/internal/services/chainSigner/chainSignerSerialization.ts.md)

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

| Test                                                                                                                                                                                            | Covers                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`chain signer serialization > preserves full transaction fields and byte message signatures through an inline SDK`](../../../../../../test/evm/chainSignerSerialization.test.ts#L16) (line 16) | —                                                                                                                         |
| [`chain signer serialization > preserves full transaction fields and byte message signatures through an SDK worker`](../../../../../../test/evm/chainSignerSerialization.test.ts#L19) (line 19) | —                                                                                                                         |
| [`chain signer serialization > round-trips a normalized transaction request`](../../../../../../test/evm/chainSignerSerialization.test.ts#L28) (line 28)                                        | [`REQ-RUN-6-MTBT2H.T1.P1`](../../../../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-6-mtbt2h) |
| [`chain signer serialization > reconstructs a native provider-backed transaction response`](../../../../../../test/evm/chainSignerSerialization.test.ts#L62) (line 62)                          | —                                                                                                                         |
| [`chain signer serialization > allows explicit client-side replacement detection`](../../../../../../test/evm/chainSignerSerialization.test.ts#L83) (line 83)                                   | —                                                                                                                         |
| [`chain signer serialization > rejects fields that cannot cross the runtime port`](../../../../../../test/evm/chainSignerSerialization.test.ts#L87) (line 87)                                   | [`REQ-RUN-6-MTBT2H.T1.P4`](../../../../implementation/views/architecture/sdk/runtime-and-concurrency.md#req-run-6-mtbt2h) |
| [`chain signer serialization > adds gas headroom to estimates and limitless sends through an inline SDK`](../../../../../../test/evm/chainSignerSerialization.test.ts#L22) (line 22)            | [`REQ-SDK-ARCH-5-AAM7YK.T1.P4`](../../../../specification/runtime/sdk.md#req-sdk-arch-5-aam7yk.t1.p4)                     |
| [`chain signer serialization > adds gas headroom to estimates and limitless sends through an SDK worker`](../../../../../../test/evm/chainSignerSerialization.test.ts#L25) (line 25)            | [`REQ-SDK-ARCH-5-AAM7YK.T1.P5`](../../../../specification/runtime/sdk.md#req-sdk-arch-5-aam7yk.t1.p5)                     |
