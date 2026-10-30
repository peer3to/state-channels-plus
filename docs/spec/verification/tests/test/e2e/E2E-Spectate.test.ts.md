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
joiner's `joinChannel` then has its held first submission refused and its retry submitted as the
second and last held submission, returns `true`, and ends on-chain pending and `PENDING_PARTICIPANT`
with one countersignature request answered by the pending participant, no abort, no `onLeftChannel` and
no status change to `SYNCED` since the call), genesis and
block-0 joins, concurrent
sync dedup, mutual blacklisting on an unprovable target, minimum-height payload proving (heights 0/1
and requests at or below a leave), and dispute-window recovery inside `generateSyncPayload`. Oracles are peer
status and sync/block-height assertions, storage and blacklist queries through control RPC, event
spies, and direct decode of generated sync payloads against the responder's latest height. One test is
currently blocked on known product bugs (#352, #353) and carries no ID. The fork-traversal and
post-dispute writes wait for tip agreement (hash, height, state) on the honest peers, not for every
explicit signature on the tip: a peer that commits a block from calldata can miss a signature sent
before it held the block, and the next block finalizes the tip by virtual voting. The fork-traversal
case then waits until the chain snapshot reaches the reduced fork: its own post can run before the
reduction is final, and the peers' adoption post moves the chain snapshot. Out of scope: the
forged-payload element matrix, balance-invariant checks, and chain-level no-transaction
observation (`INV-SYNC-4-Z6HER7`). The former bundled permutations have been atomized into
one-scenario IDs, so the latest/pinned successes, refusals, no-op skips, and abort cases here
now carry their own assignments.
Spectator spawns in this suite go through the shared `addSpectatorAuthoring` helper (`test/harness/JoinActions.test.ts.md`): the spawn runs unawaited while the named participants keep authoring, bounded by literal minimum and maximum block counts, so no spawn or promotion sits inside an idle authoring window.

The finalized-window joiner scenario selects surviving honest responders. Recovery after accepting a genesis-only proof from a removed peer remains unverified: `REQ-SYNC-1-T2589H.T1.P16`, tracked by `FIND-SYNC-1-JWY1C8`.

The kill-period case runs the real `sync` RPC, parks the requester at its window persistence after the proof arrived, commits a dispute on the pinned fork, and releases: the sync resolves `true`, neither peer blacklists the other, the requester stays on the fork, and the dispute still resolves with no host error.

The lagging-provider case pins a participant's provider at the current block, lands a held exit
snapshot post that the responder observes, and runs the participant's real `sync` RPC to the
responder; the provider catches up while the sync waits on the payload's chain block and a real
block is mined, and the sync completes with no rejection and the responder kept.

The two chain-final window cases lose participant 2's InboundMessagesProcessed delivery from before a top-up of peer 0: one holds its handler, the other drops the subscribed log so that only chain-log recovery can deliver it. That recovery can already run while participant 2 audits the dispute, before the sync. Each then lands only the reduction on chain, so the window is chain-final while the chain stays on the source fork. Peer 0 serves a payload whose window inbound list carries an extra fabricated successor of the top-up, and participant 2 accepts it. Releasing the holds replays the reduction events and, in the held case, the held chain event; the chain adopts the reduced fork. Participant 2 then holds the genuine top-up, from the replayed event or, in the dropped case, from chain-log recovery. The dropped case checks only this end state, not that the block arrives after the sync, because the recovery may run before it. The participants then author three blocks; the test decodes every new block on the reduced fork and requires one authored by participant 2 whose signature recovers to it and whose inbound blocks do not include the fabricated successor. All three stay in sync, none of them holds the fabricated block, and every inbound head equals the genuine top-up.

A third chain-final case uses the held-handler staging, which also keeps participant 2 out of the window's dispute logs, so the sync is its only source of the window's confirmations. Peer 0's payload adds a non-participant's signature to every dispute confirmation, a confirmation of a dispute the chain never committed and a latest snapshot with another timestamp. Participant 2 accepts it and stores none of the forged signatures or the uncommitted dispute. After the holds are released, peer 3 requests the window from participant 2: the served window reduces to the chain's reduced fork, carries exactly the window's genuine disputes, recovered from the chain's dispute logs, and none of the forged signatures.

The overlapping-sync case (staging in `test/fixtures/MonotonicSyncInstallStaging.ts`) replays the
race of two queue-expiry probes. One source has finalized up to the tip; the other, the tip's
author, still serves the final point below it with the tail. The observer takes the tip block from
both sources through its control port while blind to gossip; at the queue timeout it probes both.
Only the application of the author's answer is held: the other source's sync installs the tip, the
observer's tip then keeps only its author's signature, and the held answer is released. Its sync
returns true, the install entry is never called, the VM state equals the first source's, and after
three more live blocks the observer has executed them with no fraud proof, dispute or blacklisted
participant.

The unreduced-window cases share one staging: every participant holds its own reduction and counts
sync requests, peer 1 opens a valid self-removal dispute, and a fresh joiner connects inside the
kill period or after it; once its first answer is applied (held after apply, then released, so
the wait has started) and the kill period ended, the joiner is still OPENED and the chain has not reduced the window. After one participant reduces it, the
joiner reaches SYNCED with exactly one responder answering twice, no abort and no blacklist. Cutting
the joiner at its responder during the wait makes the initial load abort once with no internal
error; stopping the joiner sends no further request, aborts nothing and settles its pending sync
(a later sync to the same responder returns false instead of joining it); a status moved to SYNCED
during the wait stays SYNCED with no abort; a failing local milestone walk on the repeated request
reaches the top-level error handling once and never runs the connection hook for that responder.

The participant probe case commits an honest invalid-transition dispute and has one honest
participant probe another with the pinned sync a queued block's source probe sends, while the kill
period is open. The sync returns true only after the chain reduced the window, the responder
answered twice, neither peer blacklisted the other and the transport stayed open.

## Tests

- `overlapping newcomer gossip waits for its membership proof without blacklisting`: none
- `spectator rejects an invalid envelope without executing or relaying it`: REQ-GOSSIP-3-HQZNQX.T1.P7
- `spectator parks not-ready work without executing or relaying it`: REQ-GOSSIP-3-HQZNQX.T1.P8
- `new participant gossip can precede another peer applying insertion`: REQ-GOSSIP-4-J5Z4DF.T1.P13
- `a new joiner slow to answer the admission sync is not blacklisted and is admitted on a later block`: REQ-GOSSIP-4-J5Z4DF.T1.P47
- `verified sync promotes an off-chain inserted spectator before chain membership changes`: REQ-SM-11-VVP01C.T1.P17
- `spectators apply fresh and late confirmations without relaying and still serve sync`: REQ-GOSSIP-3-HQZNQX.T1.P4
- `spectator becomes participant through an off-chain balance transfer`: REQ-GOSSIP-4-J5Z4DF.T1.P12
- `full-capacity insertion advances the turn without promoting a spectator`: REQ-SM-11-VVP01C.T1.P16
- `should NOT allow spectate RPC before handshake completes`: INV-RPC-1-SJS2T6.T1.P3, INV-RPC-1-SJS2T6.T1.P6, UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P3, REQ-RPC-7-9CBSHK.T1.P4, INTEGRATION-TEST-RPC-2-PBZ4QY.P2, INTEGRATION-TEST-RPC-4-EXZ35F.P4
- `should spectate successfully when on-chain snapshot is already on the same fork`: INV-SYNC-1-XCQZ28.T1.P2, UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P1, REQ-SYNC-1-T2589H.T1.P1, UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P1, REQ-MSG-9-BFN9P5.T1.P1
- `spectate atomic persistence and setState`: INV-SYNC-3-A7A2ED.T1.P29
- `skips latest state persistence when local storage is already ahead`: INV-SYNC-3-A7A2ED.T1.P30
- `aborts spectating when a finalized sync block conflicts with storage`: INV-SYNC-3-A7A2ED.T1.P3
- `should spectate successfully even when it must traverse forks (dispute -> reduced fork)`: none
- `participant whose provider lags a snapshot post syncs from a responder that saw it → the sync waits for its provider to catch up and completes; responder kept`: INV-SYNC-2-AT3RXE.T1.P4
- `responder injects an inbound successor into an unadopted chain-final window → the synced participant never stores or signs it`: INV-SYNC-1-XCQZ28.T1.P11
- `responder injects an inbound successor and the participant's subscribed inbound log is lost → the participant ends with the genuine block and never stores or signs the successor`: INV-SYNC-1-XCQZ28.T1.P14
- `responder forges the confirmations and snapshot of an unadopted chain-final window → the synced participant later serves only the window's genuine confirmations, recovered from chain logs`: INV-SYNC-1-XCQZ28.T1.P19
- `pre-dispute spectator disconnects after resolve; post-dispute joiner syncs from surviving honest responders`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P23
- `via forceInboundJoin`: none
- `via joinChannel`: none
- `joinChannel survives dispute on reduced fork`: none
- `joinChannel before forceInboundJoin → both joiners participate`: none
- `forceInboundJoin before joinChannel → the pre-signed confirmation reverts ErrorJoinChannelConfirmationNotThresholdSigned, and joinChannel collects it again once with the pending participant's countersignature and lands`: UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P11, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P78, REQ-JOINSIG-1-8X1A4V.T1.P12, REQ-TJOIN-5-Q795M7.T1.P24
- `survives dispute on reduced fork`: none
- `should spectate successfully when joining at genesis state`: none
- `should spectate successfully when joining at block 0`: none
- `collapses two concurrent sync() calls for the same peer into a single on-the-wire request`: UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P6, INV-SPC-3-EP3TPG.T1.P1, REQ-RPC-4-9VX0B9.T1.P3, REQ-RPC-4-9VX0B9.T1.P8, INTEGRATION-TEST-RPC-6-009EGG.P9
- `the source with the older final point answers after the other source's sync installed a later base → the local state is kept, no source is cut, and the next live blocks execute`: INV-SYNC-3-A7A2ED.T1.P33
- `an above-latest target can't be proven, so the responder blacklists the requester and the requester strikes the responder`: UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P3, UNIT-TEST-SPECTATE-METHODS-1-ZAB4YH.P2, REQ-SYNC-1-T2589H.T1.P6
- `serves the latest sync payload for minimum height 0 while ahead`: REQ-SYNC-1-T2589H.T1.P3, UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P2
- `serves a newer sync payload when the minimum is the leave-block height`: UNIT-TEST-SPECTATE-SERVICE-2-CHK2PD.P7, REQ-SYNC-1-T2589H.T1.P17
- `serves a newer sync payload across a leave above the minimum height`: REQ-SYNC-1-T2589H.T1.P5
- `a joiner whose initial load lands in an open kill period waits for the chain's reduction, then syncs without aborting or blacklisting a responder`: REQ-SYNC-4-AWHFPA.T1.P7
- `a fresh joiner whose served window the chain has not reduced waits for the chain's reduction, then syncs without aborting or blacklisting its responder`: REQ-SYNC-4-AWHFPA.T1.P9
- `a joiner's responder cutting it during the wait fails the repeated request: the initial load aborts once, with no internal error`: REQ-SYNC-4-AWHFPA.T1.P13
- `stopping a joiner during the wait ends it: stop resolves, no further request, no abort`: REQ-SYNC-4-AWHFPA.T1.P12
- `a joiner the chain moves out of OPENED during the wait settles engaged: the late repeated sync aborts nothing`: REQ-SYNC-4-AWHFPA.T1.P14
- `a joiner's repeated request that throws after the wait reports one top-level error and never runs the connection hook for its responder`: REQ-AUTH-5-BQG9AG.T2.P4
- `a participant's source probe while the tip fork's kill period is open waits for the chain's reduction, then proves the target without blacklisting its honest responder`: REQ-SYNC-4-AWHFPA.T1.P5
- `suppressed dispute event on the responder → the on-chain window is recovered and its successor is proved`: none
- `a spectator sees posted junk calldata → no forced timeout check and it stays synced`: REQ-BLOCK-PIPE-3-WW2SB7.T1.P19
