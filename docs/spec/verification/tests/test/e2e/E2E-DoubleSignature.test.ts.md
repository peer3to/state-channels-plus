# test/e2e/E2E-DoubleSignature.test.ts — Test Report

> **Test file:** [test/e2e/E2E-DoubleSignature.test.ts](../../../../../../test/e2e/E2E-DoubleSignature.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite runs real channel sessions and signs real protocol objects: the honest RFC 6979 signature
of a participant, a second signature by the same key made with a different nonce, and v 0/1 and
64-byte compact re-encodings of an honest signature. Block copies travel over the real
state-transition RPC (`byzantine.sendBlockConfirmation`) or through the stored-merge path
(`transition.runStoredBlockMerge`); factory-built join requests signed twice by a throwaway key travel
over the real join-signature RPC from two connected relayers. The receiver's own recovery reports
each conflict and its `P2PManager` listener decides.

Oracles: an eligible double signer is blacklisted and disconnected while the observer's status stays
unchanged (event-driven disconnection barrier), and the recorded warning carries the full digest and
a full second signature that recovers to that signer; re-encodings of an honest signature leave their
signer and the relayer unblacklisted; a node never blacklists itself and logs exactly one error for
its own key; a throwaway key and a slashed identity (slashed through a real spam-dispute kill, with
the slash's own verdict cleared first) are ignored with their eligibility logged, while a member's
double signature in the same step is blacklisted as the positive control; an injected blacklist-write
failure is logged once while the merge still persists the recovered second signature; a manager
whose disposal has started ignores a member's double signature and its disposal removes exactly one
listener; and ordinary block traffic leaves every peer unblacklisted by every other peer.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full**. Each test ID may be assigned to at most one
test across the whole tree.

| Test declaration                                                                                                                                                                                                                                    | Covers                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Double signature > a participant gossiping a second valid signature for a stored block is blacklisted by the receiver`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L24) (line 24)                                                | [`REQ-ID-5-GW1ZEY.T1.P7`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p7), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P1`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p1), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P9`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p9)   |
| [`E2E: Double signature > a relayed double signature blacklists only its signer and relayed re-encodings of an honest signature frame nobody`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L70) (line 70)                                | [`REQ-ID-5-GW1ZEY.T1.P8`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p8), [`REQ-ID-5-GW1ZEY.T1.P9`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p9), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P2`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p2)                             |
| [`E2E: Double signature > a node that recovers its own double signature never blacklists itself`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L119) (line 119)                                                                           | [`REQ-ID-5-GW1ZEY.T1.P10`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p10), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P3`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p3), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P8`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p8) |
| [`E2E: Double signature > a throwaway key's twice-signed join request blacklists neither the key nor its relayers while a member's double signature blacklists the member`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L159) (line 159) | [`REQ-ID-5-GW1ZEY.T1.P12`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p12), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P5`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p5)                                                                                                                                  |
| [`E2E: Double signature > a slashed identity's double signature is ignored while a member's double signature in the same copy blacklists the member`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L237) (line 237)                       | [`REQ-ID-5-GW1ZEY.T1.P19`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p19), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P7`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p7)                                                                                                                                  |
| [`E2E: Double signature > a failing blacklist write is logged once and never fails the recovery that found the double signature`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L285) (line 285)                                           | [`REQ-ID-5-GW1ZEY.T1.P20`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p20), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P6`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p6)                                                                                                                                  |
| [`E2E: Double signature > a manager whose disposal has started ignores a member's double signature and disposal removes exactly its listener`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L327) (line 327)                              | [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P4`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p4), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P10`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p10)                                                                                                        |
| [`E2E: Double signature > ordinary block traffic blacklists no peer`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L354) (line 354)                                                                                                       | [`REQ-ID-5-GW1ZEY.T1.P11`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p11)                                                                                                                                                                                                                                                                   |
