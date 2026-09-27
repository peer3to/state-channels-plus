# test/e2e/E2E-DoubleSignature.test.ts — Test Report

> **Test file:** [test/e2e/E2E-DoubleSignature.test.ts](../../../../../../test/e2e/E2E-DoubleSignature.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite runs real channel sessions and crafts block confirmations over a stored block with real
signatures: the honest RFC 6979 signature of a participant, a second signature by the same key
made with a different nonce, and v 0/1 and 64-byte compact re-encodings of an honest signature.
Copies travel over the real state-transition RPC (`byzantine.sendBlockConfirmation`) or through the
stored-merge path (`transition.runStoredBlockMerge`). The receiver's own recovery reports the
conflict and its `P2PManager` listener blacklists the signer.

Oracles: the observer blacklists and disconnects the double signer while its status stays
unchanged (event-driven disconnection barrier); in the same copy, re-encodings of an honest
signature leave both their signer and the relaying peer unblacklisted; a node never blacklists
itself while it does blacklist another double signer in the same merge; and ordinary block traffic
leaves every peer unblacklisted by every other peer.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full**. Each test ID may be assigned to at most one
test across the whole tree.

| Test declaration                                                                                                                                                                                                     | Covers                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: Double signature > a participant gossiping a second valid signature for a stored block is blacklisted by the receiver`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L15) (line 15)                 | [`REQ-ID-5-GW1ZEY.T1.P7`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p7), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P1`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p1)                                                                                                        |
| [`E2E: Double signature > a relayed double signature blacklists only its signer and relayed re-encodings of an honest signature frame nobody`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L60) (line 60) | [`REQ-ID-5-GW1ZEY.T1.P8`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p8), [`REQ-ID-5-GW1ZEY.T1.P9`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p9), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P2`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p2) |
| [`E2E: Double signature > a node that recovers its own double signature never blacklists itself`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L124) (line 124)                                            | [`REQ-ID-5-GW1ZEY.T1.P10`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p10), [`UNIT-TEST-P2PMANAGER-33-XKAJJN.P3`](../../../../implementation/source/src/P2PManager.ts.md#unit-test-p2pmanager-33-xkajjn.p3)                                                                                                      |
| [`E2E: Double signature > ordinary block traffic blacklists no peer`](../../../../../../test/e2e/E2E-DoubleSignature.test.ts#L166) (line 166)                                                                        | [`REQ-ID-5-GW1ZEY.T1.P11`](../../../../specification/protocol-model/identity.md#req-id-5-gw1zey.t1.p11)                                                                                                                                                                                                                                       |
