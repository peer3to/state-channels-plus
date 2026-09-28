# test/e2e/E2E-DoubleSignature.test.ts — Test Report

> **Test file:** [test/e2e/E2E-DoubleSignature.test.ts](../../../../../../test/e2e/E2E-DoubleSignature.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite runs real channel sessions and signs real protocol objects: the honest RFC 6979 signature
of a participant, and a second signature by the same key made with a different nonce. Block copies travel over the real
state-transition RPC (`byzantine.sendBlockConfirmation`) or through the stored-merge path
(`transition.runStoredBlockMerge`); factory-built join requests signed twice by a throwaway key travel
over the real join-signature RPC from two connected relayers. The receiver's own recovery reports
each conflict and its `P2PManager` listener decides.

Oracles: an eligible double signer is blacklisted and disconnected while the observer's status stays
unchanged (event-driven disconnection barrier), and the recorded warning carries the full digest and
a full second signature that recovers to that signer; the relayer and an honest signer in the same copy
stay unblacklisted; a node never blacklists itself and logs exactly one error for
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
| [`E2E: Double signature > a participant gossiping a second valid signature for a stored block is blacklisted by the receiver`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L22) (line 22)                                                | [`REQ-ID-5-GW1ZEY.T1.P7`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p7), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P1`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p1), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P9`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p9)   |
| [`E2E: Double signature > a relayed double signature blacklists only its signer`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L68) (line 68)                                                                                             | [`REQ-ID-5-GW1ZEY.T1.P8`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p8), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P2`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p2)                                                                                                                                    |
| [`E2E: Double signature > a node that recovers its own double signature never blacklists itself`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L113) (line 113)                                                                           | [`REQ-ID-5-GW1ZEY.T1.P10`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p10), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P3`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p3), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P8`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p8) |
| [`E2E: Double signature > a throwaway key's twice-signed join request blacklists neither the key nor its relayers while a member's double signature blacklists the member`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L153) (line 153) | [`REQ-ID-5-GW1ZEY.T1.P12`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p12), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P5`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p5)                                                                                                                                  |
| [`E2E: Double signature > a slashed identity's double signature is ignored while a member's double signature in the same copy blacklists the member`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L231) (line 231)                       | [`REQ-ID-5-GW1ZEY.T1.P19`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p19), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P7`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p7)                                                                                                                                  |
| [`E2E: Double signature > a failing blacklist write is logged once and never fails the recovery that found the double signature`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L279) (line 279)                                           | [`REQ-ID-5-GW1ZEY.T1.P20`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p20), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P6`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p6)                                                                                                                                  |
| [`E2E: Double signature > a manager whose disposal has started ignores a member's double signature and disposal removes exactly its listener`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L321) (line 321)                              | [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P4`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p4), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P10`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p10)                                                                                                        |
| [`E2E: Double signature > ordinary block traffic blacklists no peer`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L348) (line 348)                                                                                                       | [`REQ-ID-5-GW1ZEY.T1.P11`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p11)                                                                                                                                                                                                                                                                   |
