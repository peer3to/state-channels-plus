# test/cache/SignerRecoveryCache.test.ts — Test Report

> **Test file:** [test/cache/SignerRecoveryCache.test.ts](../../../../../../test/cache/SignerRecoveryCache.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [src/cache/SignerRecoveryCache.ts](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite exercises the signer-recovery cache directly with real signatures from random ethers
wallets. It checks recovered addresses against both the signing wallet and `ethers.verifyMessage`,
proves repeated `(message, signature)` pairs reuse one cache entry, proves the message is part of
the cache key, and verifies the configured size bound and oldest-entry eviction.

The double-signature cases register listeners with `onDoubleSignature` and remove them in
`finally`. A second signature is a real signature by the same key made with an explicit different
nonce (`signBlockVariant`); re-encodings are the v 0/1, v 35/36 and 64-byte compact forms of one
real signature. The oracles are the exact report contents (signer, message hex, both canonical
signatures) or the absence of any report, the canonical-memo size under a lowered bound, and which
listener heard which report. Kind-specific cases sign a factory-built join, transaction, dispute or
open with the SDK's `SignatureUtils` signing helper, add a nonce variant over the same encoding, and
recover both through the matching `SignatureUtils` recovery helper. A throwing listener must leave
recovery and the other listener intact, and signing one block or join twice through the SDK path must
give identical bytes. The cache is reset before each test, and the bound tests restore the
global size setting in `finally`.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full**. Each test ID may be assigned to at most one
test across the whole tree.

| Test declaration | Covers |
| --- | --- |
| [`SignerRecoveryCache > recovers the correct signer (matches verifyMessage)`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L27) (line 27) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P1`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p1) |
| [`SignerRecoveryCache > memoizes by (message, signature) — repeats add no entries`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L35) (line 35) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P2`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p2) |
| [`SignerRecoveryCache > keys on the message too — same signer, different message, distinct entries`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L47) (line 47) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P3`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p3) |
| [`SignerRecoveryCache > bounds size and evicts oldest past SIGNER_RECOVERY_CACHE_MAX`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L58) (line 58) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P4`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p4) |
| [`SignerRecoveryCache > double-signature detection > recovering the same signature twice reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L78) (line 78) | [`REQ-ID-5-GW1ZEY.T1.P1`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p1), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P5`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p5) |
| [`SignerRecoveryCache > double-signature detection > a second nonce signature by one signer on one message reports that signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L90) (line 90) | [`REQ-ID-5-GW1ZEY.T1.P2`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p2), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P6`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p6) |
| [`SignerRecoveryCache > double-signature detection > a v 0/1 re-encoding of a recovered signature reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L113) (line 113) | [`REQ-ID-5-GW1ZEY.T1.P3`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p3), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P7`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p7) |
| [`SignerRecoveryCache > double-signature detection > a v 35/36 re-encoding of a recovered signature reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L129) (line 129) | [`REQ-ID-5-GW1ZEY.T1.P4`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p4), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P8`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p8) |
| [`SignerRecoveryCache > double-signature detection > a 64-byte compact re-encoding of a recovered signature reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L145) (line 145) | [`REQ-ID-5-GW1ZEY.T1.P5`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p5), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P9`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p9) |
| [`SignerRecoveryCache > double-signature detection > the 65-byte signature after its compact re-encoding reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L161) (line 161) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P10`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p10) |
| [`SignerRecoveryCache > double-signature detection > one signer's signatures on different messages report nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L173) (line 173) | [`REQ-ID-5-GW1ZEY.T1.P6`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p6), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P11`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p11) |
| [`SignerRecoveryCache > double-signature detection > two signers' signatures on one message report nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L187) (line 187) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P12`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p12) |
| [`SignerRecoveryCache > double-signature detection > the canonical-signature memo is bounded by SIGNER_RECOVERY_CACHE_MAX`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L207) (line 207) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P13`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p13) |
| [`SignerRecoveryCache > double-signature detection > a conflict with an evicted signer entry goes unreported while a retained one is reported`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L221) (line 221) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P14`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p14) |
| [`SignerRecoveryCache > double-signature detection > every registered listener hears a report`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L242) (line 242) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P15`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p15) |
| [`SignerRecoveryCache > double-signature detection > a removed listener hears no later report`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L262) (line 262) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P16`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p16) |
| [`SignerRecoveryCache > double-signature detection > a throwing listener neither fails recovery nor starves another listener`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L280) (line 280) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P17`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p17) |
| [`SignerRecoveryCache > double-signature detection > a join signature re-signed with another nonce reports its signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L301) (line 301) | [`REQ-ID-5-GW1ZEY.T1.P13`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p13), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P18`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p18) |
| [`SignerRecoveryCache > double-signature detection > a transaction signature re-signed with another nonce reports its signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L319) (line 319) | [`REQ-ID-5-GW1ZEY.T1.P14`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p14), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P19`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p19) |
| [`SignerRecoveryCache > double-signature detection > a dispute signature re-signed with another nonce reports its signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L340) (line 340) | [`REQ-ID-5-GW1ZEY.T1.P15`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p15), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P20`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p20) |
| [`SignerRecoveryCache > double-signature detection > an open-channel signature re-signed with another nonce reports its signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L360) (line 360) | [`REQ-ID-5-GW1ZEY.T1.P16`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p16), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P21`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p21) |
| [`SignerRecoveryCache > double-signature detection > the SDK signing path signs one message to identical bytes twice`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L380) (line 380) | [`REQ-ID-5-GW1ZEY.T1.P17`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p17) |
