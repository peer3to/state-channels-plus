# test/cache/SignerRecoveryCache.test.ts — Test Report

> **Test file:** [test/cache/SignerRecoveryCache.test.ts](../../../../../../test/cache/SignerRecoveryCache.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [SignerRecoveryCache.ts](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite calls `recoverSigner` and `isContractAcceptedSignature` directly, with the memo reset
before each test; shared signing helpers live in `test/fixtures/RecoveryCacheFixture.ts` and
`test/fixtures/SignatureEncodingFixture.ts`. A record-only observer (`recordSignerRecoveries`)
lists the digests the memo lets through to a real recovery. The first four tests use real wallet
signatures over random 32-byte messages: the recovered address equals both the wallet address and
`ethers.verifyMessage`; repeated recoveries of one pair keep one memo entry and a second pair adds
one. Two tests isolate each half of the key against the uncached `verifyMessage` oracle, each
calling twice: one signature over two messages recovers each message's own signer (a different
address for the second message), and one message signed by two wallets recovers each wallet; both
end with two memo entries and exactly one real recovery per distinct pair. With `SIGNER_RECOVERY_CACHE_MAX` lowered to 3,
the eviction test checks by the recorded recoveries that a hit does not refresh an entry, that the
oldest insert is evicted first, and that an evicted pair recovers its signer again (the bound is
restored in `finally`). The rejection test recovers an ordinary signature once, then feeds all ten
contract-rejected re-encodings of it: each throws "signature is not accepted by the contracts",
the memo size stays 1, and no rejected encoding reaches a real recovery.

The parity test deploys a real `UtilityFacet` and takes one wallet signature over
`keccak256(encodedData)`, the digest blocks are signed over, in the ordinary encoding and in every
contract-rejected re-encoding from `SignatureEncodingFixture` (compact 64-byte, `v` of 0/1,
EIP-155 `v`, high `s`, zero `r`, zero `s`, `r` at the group order, 66 bytes, 63 bytes, empty). For
each it compares the contract's `retrieveSignerAddress` verdict and signer with
`isContractAcceptedSignature` and `recoverSigner` (a throw counts as no signer), and pins the full
verdict table: only the ordinary encoding is accepted. This is the differential parity test the
signature carve-out requires.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full**. Each test ID may be assigned to at most one
test across the whole tree.

| Test declaration | Covers |
| --- | --- |
| [`SignerRecoveryCache > recovers the correct signer (matches verifyMessage)`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L25) (line 25) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P1`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p1) |
| [`SignerRecoveryCache > memoizes by (message, signature) — repeats add no entries`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L33) (line 33) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P2`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p2) |
| [`SignerRecoveryCache > keys on the message — one signature over two messages recovers each message's own signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L45) (line 45) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P7`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p7) |
| [`SignerRecoveryCache > keys on the signature — one message signed by two signers recovers each signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L75) (line 75) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P8`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p8) |
| [`SignerRecoveryCache > evicts the oldest entry first at SIGNER_RECOVERY_CACHE_MAX and recomputes it correctly`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L107) (line 107) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P4`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p4) |
| [`SignerRecoveryCache > every contract-rejected encoding throws before the memo and leaves it unchanged`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L152) (line 152) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P6`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p6) |
| [`SignerRecoveryCache > contract acceptance parity > accepts exactly the encodings the contracts accept, recovering the same signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L184) (line 184) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P5`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p5), [`INV-MIRROR-1-VAF778.T1.P7`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778.t1.p7) |
