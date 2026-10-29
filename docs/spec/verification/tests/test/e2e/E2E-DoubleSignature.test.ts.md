# E2E-DoubleSignature.test.ts

Test file: [test/e2e/E2E-DoubleSignature.test.ts](../../../../../../test/e2e/E2E-DoubleSignature.test.ts)

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

## Tests

- `a participant gossiping a second valid signature for a stored block is blacklisted by the receiver`: REQ-ID-5-GW1ZEY.T1.P7, UNIT-TEST-P2PMANAGER-33-XKAJJN.P1, UNIT-TEST-P2PMANAGER-33-XKAJJN.P9
- `a relayed double signature blacklists only its signer`: REQ-ID-5-GW1ZEY.T1.P8, UNIT-TEST-P2PMANAGER-33-XKAJJN.P2
- `a node that recovers its own double signature never blacklists itself`: REQ-ID-5-GW1ZEY.T1.P10, UNIT-TEST-P2PMANAGER-33-XKAJJN.P3, UNIT-TEST-P2PMANAGER-33-XKAJJN.P8
- `a throwaway key's twice-signed join request blacklists neither the key nor its relayers while a member's double signature blacklists the member`: REQ-ID-5-GW1ZEY.T1.P12, UNIT-TEST-P2PMANAGER-33-XKAJJN.P5
- `a slashed identity's double signature is ignored while a member's double signature in the same copy blacklists the member`: REQ-ID-5-GW1ZEY.T1.P19, UNIT-TEST-P2PMANAGER-33-XKAJJN.P7
- `a failing blacklist write is logged once and never fails the recovery that found the double signature`: REQ-ID-5-GW1ZEY.T1.P20, UNIT-TEST-P2PMANAGER-33-XKAJJN.P6
- `a manager whose disposal has started ignores a member's double signature and disposal removes exactly its listener`: UNIT-TEST-P2PMANAGER-33-XKAJJN.P4, UNIT-TEST-P2PMANAGER-33-XKAJJN.P10
- `ordinary block traffic blacklists no peer`: REQ-ID-5-GW1ZEY.T1.P11
