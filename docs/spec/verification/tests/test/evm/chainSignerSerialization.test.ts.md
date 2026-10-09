# chainSignerSerialization.test.ts

Test file: [test/evm/chainSignerSerialization.test.ts](../../../../../../test/evm/chainSignerSerialization.test.ts)
Exercises: [chainSignerSerialization.ts](../../../../implementation/source/src/rpc/internal/services/chainSigner/chainSignerSerialization.ts.md)

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

## Tests

- `preserves full transaction fields and byte message signatures through an inline SDK`: none
- `preserves full transaction fields and byte message signatures through an SDK worker`: none
- `round-trips a normalized transaction request`: none
- `reconstructs a native provider-backed transaction response`: none
- `allows explicit client-side replacement detection`: none
- `rejects fields that cannot cross the runtime port`: none
- `adds gas headroom to estimates and limitless sends through an inline SDK`: REQ-SDK-ARCH-5-AAM7YK.T1.P4
- `adds gas headroom to estimates and limitless sends through an SDK worker`: REQ-SDK-ARCH-5-AAM7YK.T1.P5
