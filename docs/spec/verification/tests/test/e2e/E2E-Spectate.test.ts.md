# E2E-Spectate.test.ts

Test file: [test/e2e/E2E-Spectate.test.ts](../../../../../../test/e2e/E2E-Spectate.test.ts)

## Overview

The suite drives the full spectator lifecycle end to end through the `MathTestSession` harness:
real multi-peer channels, harness control RPC into each peer's host-side `StateManager`, and
`execOnHost` bodies where an interleaving has to be staged in-process (mutex-guarded persistence,
captured pre-handshake transports). The guard case sends a request on an incomplete-handshake
transport, asserts the exact guard error and zero endpoint admission, then completes a valid
spectate request over a separate authenticated session. Other covered flows include same-fork
spectating with atomic persistence and conflict aborts,
fork-traversal and post-dispute spectating, spectator promotion to participant (`forceInboundJoin`
and `joinChannel`, including concurrent promotion races — the losing joiner's static call is
decoded and matched against the widened threshold set and the set its pre-signed signatures
recover to, which is what identifies the pending participant as the missing signer; the losing
joiner's client-side cleanup is read as the status-hook transition back to `SYNCED` immediately
followed by the abort transition to `OPENED`, plus a cleared force-join submission height, because
the abort sets `OPENED` itself and would otherwise hide both cleanup effects), genesis and
block-0 joins, concurrent
sync dedup, mutual blacklisting on an unprovable target, minimum-height payload proving (heights 0/1
and requests at or below a leave), and dispute-window recovery inside `generateSyncPayload`. Oracles are peer
status and sync/block-height assertions, storage and blacklist queries through control RPC, event
spies, and direct decode of generated sync payloads against the responder's latest height. Three tests are
currently blocked or flaky on known product bugs (#351–#353) and carry no IDs. Out of scope: the
forged-payload element matrix, balance-invariant checks, and chain-level no-transaction
observation (`INV-SYNC-4-Z6HER7`). The former bundled permutations have been atomized into
one-scenario IDs, so the latest/pinned successes, refusals, no-op skips, and abort cases here
now carry their own assignments.
Spectator spawns in this suite go through the shared `addSpectatorAuthoring` helper (`test/harness/JoinActions.test.ts.md`): the spawn runs unawaited while the named participants keep authoring, bounded by literal minimum and maximum block counts, so no spawn or promotion sits inside an idle authoring window.

The finalized-window joiner scenario selects surviving honest responders. Recovery after accepting a genesis-only proof from a removed peer remains unverified: `REQ-SYNC-1-T2589H.T1.P16`, tracked by `FIND-SYNC-1-JWY1C8`.

The kill-period case runs the real `sync` RPC, parks the requester at its window persistence after the proof arrived, commits a dispute on the pinned fork, and releases: the sync resolves `true`, neither peer blacklists the other, the requester stays on the fork, and the dispute still resolves with no host error.

The two chain-final window cases lose participant 2's InboundMessagesProcessed delivery from before a top-up of peer 0: one holds its handler, the other drops the subscribed log so that only chain-log recovery can deliver it. That recovery can already run while participant 2 audits the dispute, before the sync. Each then lands only the reduction on chain, so the window is chain-final while the chain stays on the source fork. Peer 0 serves a payload whose window inbound list carries an extra fabricated successor of the top-up, and participant 2 accepts it. Releasing the holds replays the reduction events and, in the held case, the held chain event; the chain adopts the reduced fork. Participant 2 then holds the genuine top-up, from the replayed event or, in the dropped case, from chain-log recovery. The dropped case checks only this end state, not that the block arrives after the sync, because the recovery may run before it. The participants then author three blocks; the test decodes every new block on the reduced fork and requires one authored by participant 2 whose signature recovers to it and whose inbound blocks do not include the fabricated successor. All three stay in sync, none of them holds the fabricated block, and every inbound head equals the genuine top-up.

## Tests

- `overlapping newcomer gossip waits for its membership proof without blacklisting`: none
- `spectator rejects an invalid envelope without executing or relaying it`: REQ-GOSSIP-3-HQZNQX.T1.P7
- `spectator parks not-ready work without executing or relaying it`: REQ-GOSSIP-3-HQZNQX.T1.P8
- `new participant gossip can precede another peer applying insertion`: REQ-GOSSIP-4-J5Z4DF.T1.P13
- `verified sync promotes an off-chain inserted spectator before chain membership changes`: REQ-SM-11-VVP01C.T1.P17
- `spectators apply fresh and late confirmations without relaying and still serve sync`: REQ-GOSSIP-3-HQZNQX.T1.P4
- `spectator becomes participant through an off-chain balance transfer`: REQ-GOSSIP-4-J5Z4DF.T1.P12
- `full-capacity insertion advances the turn without promoting a spectator`: REQ-SM-11-VVP01C.T1.P16
- `should NOT allow spectate RPC before handshake completes`: INV-RPC-1-SJS2T6.T1.P3, INV-RPC-1-SJS2T6.T1.P6, UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P3, REQ-RPC-7-9CBSHK.T1.P4, INTEGRATION-TEST-RPC-2-PBZ4QY.P2, INTEGRATION-TEST-RPC-4-EXZ35F.P4
- `should spectate successfully when on-chain snapshot is already on the same fork`: INV-SYNC-1-XCQZ28.T1.P2, UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P1, REQ-SYNC-1-T2589H.T1.P1, UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P1, REQ-MSG-9-BFN9P5.T1.P1
- `spectate atomic persistence and setState`: none
- `skips latest state persistence when local storage is already ahead`: none
- `aborts spectating when a finalized sync block conflicts with storage`: INV-SYNC-3-A7A2ED.T1.P3
- `should spectate successfully even when it must traverse forks (dispute -> reduced fork)`: none
- `responder injects an inbound successor into an unadopted chain-final window → the synced participant never stores or signs it`: INV-SYNC-1-XCQZ28.T1.P11
- `responder injects an inbound successor and the participant's subscribed inbound log is lost → the participant ends with the genuine block and never stores or signs the successor`: INV-SYNC-1-XCQZ28.T1.P14
- `pre-dispute spectator disconnects after resolve; post-dispute joiner syncs from surviving honest responders`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P23
- `via forceInboundJoin`: none
- `via joinChannel`: none
- `joinChannel survives dispute on reduced fork`: none
- `joinChannel before forceInboundJoin → both joiners participate`: none
- `forceInboundJoin before joinChannel → joinChannel reverts ErrorJoinChannelConfirmationNotThresholdSigned (pending participant did not sign confirmation)`: UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P11, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P14
- `survives dispute on reduced fork`: none
- `should spectate successfully when joining at genesis state`: none
- `should spectate successfully when joining at block 0`: none
- `collapses two concurrent sync() calls for the same peer into a single on-the-wire request`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P6, INV-SPC-3-EP3TPG.T1.P1, REQ-RPC-4-9VX0B9.T1.P3, REQ-RPC-4-9VX0B9.T1.P8, INTEGRATION-TEST-RPC-6-009EGG.P9
- `an above-latest target can't be proven, so the responder blacklists the requester and the requester strikes the responder`: UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P3, UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P2, REQ-SYNC-1-T2589H.T1.P6
- `serves the latest sync payload for minimum height 0 while ahead`: REQ-SYNC-1-T2589H.T1.P3, UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P2
- `serves a newer sync payload when the minimum is the leave-block height`: UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P7
- `serves a newer sync payload across a leave above the minimum height`: REQ-SYNC-1-T2589H.T1.P5
- `suppressed dispute event on the responder → the on-chain window is recovered and its successor is proved`: none
- `a spectator sees posted junk calldata → no forced timeout check and it stays synced`: REQ-BLOCK-PIPE-3-WW2SB7.T1.P19
