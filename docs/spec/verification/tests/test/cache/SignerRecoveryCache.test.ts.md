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
listener heard which report. The cache is reset before each test, and the bound tests restore the
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
| [`SignerRecoveryCache > double-signature detection > recovering the same signature twice reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L97) (line 97) | [`REQ-ID-5-GW1ZEY.T1.P1`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p1), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P5`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p5) |
| [`SignerRecoveryCache > double-signature detection > a second nonce signature by one signer on one message reports that signer`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L109) (line 109) | [`REQ-ID-5-GW1ZEY.T1.P2`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p2), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P6`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p6) |
| [`SignerRecoveryCache > double-signature detection > a v 0/1 re-encoding of a recovered signature reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L132) (line 132) | [`REQ-ID-5-GW1ZEY.T1.P3`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p3), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P7`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p7) |
| [`SignerRecoveryCache > double-signature detection > a v 35/36 re-encoding of a recovered signature reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L148) (line 148) | [`REQ-ID-5-GW1ZEY.T1.P4`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p4), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P8`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p8) |
| [`SignerRecoveryCache > double-signature detection > a 64-byte compact re-encoding of a recovered signature reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L164) (line 164) | [`REQ-ID-5-GW1ZEY.T1.P5`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p5), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P9`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p9) |
| [`SignerRecoveryCache > double-signature detection > the 65-byte signature after its compact re-encoding reports nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L180) (line 180) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P10`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p10) |
| [`SignerRecoveryCache > double-signature detection > one signer's signatures on different messages report nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L192) (line 192) | [`REQ-ID-5-GW1ZEY.T1.P6`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p6), [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P11`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p11) |
| [`SignerRecoveryCache > double-signature detection > two signers' signatures on one message report nothing`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L206) (line 206) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P12`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p12) |
| [`SignerRecoveryCache > double-signature detection > the canonical-signature memo is bounded by SIGNER_RECOVERY_CACHE_MAX`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L226) (line 226) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P13`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p13) |
| [`SignerRecoveryCache > double-signature detection > a conflict with an evicted signer entry goes unreported while a retained one is reported`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L240) (line 240) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P14`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p14) |
| [`SignerRecoveryCache > double-signature detection > every registered listener hears a report`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L261) (line 261) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P15`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p15) |
| [`SignerRecoveryCache > double-signature detection > a removed listener hears no later report`](../../../../../../test/cache/SignerRecoveryCache.test.ts#L281) (line 281) | [`UNIT-TEST-SIGNERRECOVERYCACHE-1-GV89W4.P16`](../../../../implementation/source/src/cache/SignerRecoveryCache.ts.md#unit-test-signerrecoverycache-1-gv89w4.p16) |
