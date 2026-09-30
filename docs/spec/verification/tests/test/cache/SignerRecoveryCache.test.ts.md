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

The double-signature cases register listeners with `onDoubleSignature` and remove them in
`finally`. A second signature is a real signature by the same key made with an explicit different
nonce (`signBlockVariant`); re-encodings are the v 0/1, v 35/36 and 64-byte compact forms of one
real signature, which the contracts reject: each must throw before the memo and report nothing. The oracles are the exact report contents (signer, message hex, both canonical
signatures) or the absence of any report, the canonical-memo size under a lowered bound, and which
listener heard which report. Kind-specific cases sign a factory-built join, transaction, dispute or
open with the SDK's `SignatureUtils` signing helper, add a nonce variant over the same encoding, and
recover both through the matching `SignatureUtils` recovery helper. A throwing listener must leave
recovery and the other listener intact, and signing one block or join twice through the SDK path must
give identical bytes. The bound tests restore the global size setting in `finally`.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full**. Each test ID may be assigned to at most one
test across the whole tree.

| Test declaration | Covers |
| --- | --- |
| [`SignerRecoveryCache > recovers the correct signer (matches verifyMessage)`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L34) (line 34) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P1`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p1) |
| [`SignerRecoveryCache > memoizes by (message, signature) — repeats add no entries`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L42) (line 42) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P2`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p2) |
| [`SignerRecoveryCache > keys on the message — one signature over two messages recovers each message's own signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L54) (line 54) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P7`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p7) |
| [`SignerRecoveryCache > keys on the signature — one message signed by two signers recovers each signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L84) (line 84) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P8`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p8) |
| [`SignerRecoveryCache > evicts the oldest entry first at SIGNER_RECOVERY_CACHE_MAX and recomputes it correctly`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L116) (line 116) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P4`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p4) |
| [`SignerRecoveryCache > every contract-rejected encoding throws before the memo and leaves it unchanged`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L161) (line 161) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P6`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p6) |
| [`SignerRecoveryCache > contract acceptance parity > accepts exactly the encodings the contracts accept, recovering the same signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L193) (line 193) | [`UNIT-TEST-SIGNER-RECOVERY-CACHE-1-J4Y8ZP.P5`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signer-recovery-cache-1-j4y8zp.p5), [`INV-MIRROR-1-VAF778.T1.P7`](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778.t1.p7) |
| [`SignerRecoveryCache > double-signature detection > recovering the same signature twice reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L238) (line 238) | [`REQ-ID-5-GW1ZEY.T1.P1`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p1), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P5`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p5) |
| [`SignerRecoveryCache > double-signature detection > a second nonce signature by one signer on one message reports that signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L250) (line 250) | [`REQ-ID-5-GW1ZEY.T1.P2`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p2), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P6`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p6) |
| [`SignerRecoveryCache > double-signature detection > a v 0/1 re-encoding of a recovered signature reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L273) (line 273) | [`REQ-ID-5-GW1ZEY.T1.P3`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p3), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P7`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p7) |
| [`SignerRecoveryCache > double-signature detection > a v 35/36 re-encoding of a recovered signature reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L291) (line 291) | [`REQ-ID-5-GW1ZEY.T1.P4`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p4), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P8`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p8) |
| [`SignerRecoveryCache > double-signature detection > a 64-byte compact re-encoding of a recovered signature reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L309) (line 309) | [`REQ-ID-5-GW1ZEY.T1.P5`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p5), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P9`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p9) |
| [`SignerRecoveryCache > double-signature detection > the 65-byte signature after its compact re-encoding reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L327) (line 327) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P10`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p10) |
| [`SignerRecoveryCache > double-signature detection > one signer's signatures on different messages report nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L344) (line 344) | [`REQ-ID-5-GW1ZEY.T1.P6`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p6), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P11`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p11) |
| [`SignerRecoveryCache > double-signature detection > two signers' signatures on one message report nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L358) (line 358) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P12`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p12) |
| [`SignerRecoveryCache > double-signature detection > the canonical-signature memo is bounded by SIGNER_RECOVERY_CACHE_MAX`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L378) (line 378) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P13`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p13) |
| [`SignerRecoveryCache > double-signature detection > a conflict with an evicted signer entry goes unreported while a retained one is reported`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L392) (line 392) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P14`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p14) |
| [`SignerRecoveryCache > double-signature detection > every registered listener hears a report`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L413) (line 413) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P15`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p15) |
| [`SignerRecoveryCache > double-signature detection > a removed listener hears no later report`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L433) (line 433) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P16`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p16) |
| [`SignerRecoveryCache > double-signature detection > a throwing listener neither fails recovery nor starves another listener`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L451) (line 451) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P17`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p17) |
| [`SignerRecoveryCache > double-signature detection > a join signature re-signed with another nonce reports its signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L472) (line 472) | [`REQ-ID-5-GW1ZEY.T1.P13`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p13), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P18`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p18) |
| [`SignerRecoveryCache > double-signature detection > a transaction signature re-signed with another nonce reports its signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L490) (line 490) | [`REQ-ID-5-GW1ZEY.T1.P14`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p14), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P19`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p19) |
| [`SignerRecoveryCache > double-signature detection > a dispute signature re-signed with another nonce reports its signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L511) (line 511) | [`REQ-ID-5-GW1ZEY.T1.P15`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p15), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P20`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p20) |
| [`SignerRecoveryCache > double-signature detection > an open-channel signature re-signed with another nonce reports its signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L531) (line 531) | [`REQ-ID-5-GW1ZEY.T1.P16`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p16), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P21`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p21) |
| [`SignerRecoveryCache > double-signature detection > the SDK signing path signs one message to identical bytes twice`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L551) (line 551) | [`REQ-ID-5-GW1ZEY.T1.P17`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p17) |
