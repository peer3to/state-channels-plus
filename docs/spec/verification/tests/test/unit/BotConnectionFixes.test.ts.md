# BotConnectionFixes.test.ts

Test file: [test/unit/BotConnectionFixes.test.ts](../../../../../../test/unit/BotConnectionFixes.test.ts)

## Overview

Exercises channel discovery, terminal leave, authoritative initial-sync eligibility and force-join timing through runtime APIs and real channel state.

The own-join cases carry the IDs `U75a`…`U75h`. `U75e` holds the joiner's force-join deadline task
and parks every snapshot post; the founders omit the joiner's landed join and author nothing, so a
founder's participant-timeout dispute opens the window and the leaving joiner answers it with its own
self-removal dispute while its force-join record shows no dispute started. After the reduction the joiner
is still pending and the chain still lists it; the posts are released, the founders author until the
chain drops it, and only then the held deadline task runs. The joiner's dispute requests are observed
from the reduction on: none is made, the joiner ends `SYNCED` with one `onLeftChannel` and no tracked
join. `U75g` fails a prepared first join's receipt (the snapshot stays at its pin), then, once the chain
passed the two-second authorization, submits the same join again; a static call pins the second refusal
to `RaceConditionJoinChannelExpired`. The oracles are the `onLeftChannel` and `onAbort` counts and the
order of the second `onLeftChannel` before the abort. The disposal case holds a joiner's force-join
check at its membership read (the runtime's disposal releases it), lets a counted block queue one more
check, suppresses the founders' participant timeouts, disposes the joiner and, after an absence window
of two agreement windows, finds no new dispute, status or `onLeftChannel` event and no dispute window on
the fork. A second disposal case runs the joiner inline and keeps its host endpoint: a record-only probe
records every scheduled task by name, and the participant-count read of the observed join's force-join
deadline setup is held after it answered. The joiner is disposed, the read released and the join checks
settled; no join timer (`join authorization expiry`, `force join deadline`) is recorded after the
disposal. `U75f` makes a prepared first join's submission
uncertain (its authorization stays open for 120 seconds), then a founder posts a snapshot that lists no
pending join; after the joiner handled that snapshot event its status is still `PENDING_PARTICIPANT` and
its join is still pending. `U75b` lets an uncertain join pass its authorization deadline on chain and
waits for the joiner's `onLeftChannel`; the oracles are the `SYNCED` status and the ended join. `U75h`
makes a first join's submission uncertain with a 15-second authorization, holds its expiry timer and
fires it while the joiner's clock is still at or before the deadline; a record-only scheduling probe
shows the check armed the `join authorization expiry` timer again, and once the chain passed the
deadline the joiner ends `SYNCED` with one `onLeftChannel`.

The `U72` exit cases stage an exit, with a leave call or without one (an exit block the application
authors on its own turn), and most of them block its same-fork post with a JOIN the founders omit (the
joiner's force-join dispute is suppressed; the leaver's self-removal disputes are recorded, and sent only
where the case resolves the dispute). They record each `postStateSnapshotWait` of the leaver and park its
results or its `multicall` send where the case needs a post in flight. The oracles are the recorded post
results and starts, the leaver's mined send, the recorded dispute submissions, the recorded watchdog task,
the leaver's self-removal flag, the chain participants and the leaver's `onLeftChannel`. The probe
forwards each post's own result: a returned snapshot is recorded as posted, an empty return as a no-op.
A post that lands the exit while a block finalizes during it is held at its send; its oracle is one
started post and one leaver transaction. The refusal and failure cases record the leave's own logger
entries, make the post fail with an error that is no chain refusal, and settle detached work: a
refusal leaves no detached error, the failure surfaces as one. The pending-join case gives a leave of
an uncertain join a three-second watchdog and records its scheduled watchdogs until the join expires.
The fork-restart case keeps one founder blind to block gossip while the leaver authors an exit block with
no leave call, so that block is never final; another founder then signs an out-of-turn block at the exit's
height, a real invalid state transition that the blind founder disputes from the state before the exit.
The offender contributes no evidence and the leaver's own disputes are recorded, not sent, so the reduction
proves the state before the exit: the successor fork drops the offender and still seats the leaver; the oracles are its leave state on the new fork, its `onLeaveTurn` count, its self-removal flag
and the chain participants after its second exit. While a watchdog expiry is awaited the remaining participants keep authoring, so no idle writer
is timed out.

## Tests

- `U70: a lobby open makes both founders join the opened channel's discovery key as participants`: REQ-TJOIN-2-MFWADG.T2.P1, UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P6
- `U71: both founders leave and the last exit closes the channel → both get onLeftChannel on NOT_OPENED`: REQ-LIF-10-QR8NQ9.T2.P1, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P23
- `U72: a same-fork snapshot post waiting on an inbound message its snapshot has not consumed reverts with the pending-inbound refusal and posts nothing`: REQ-ENFSNAP-3-VD9T8A.T2.P1, UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P10
- `U72: a leaver posts the latest state snapshot once its exit block is final, and that snapshot settles the leave with no dispute`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P32
- `U72: a leaver whose exit is blocked by an inbound join that no block consumes posts again on each finalized block and starts one self-removal dispute when the one leave watchdog expires`: REQ-ENFSNAP-3-VD9T8A.T2.P2, REQ-LIF-10-QR8NQ9.T1.P13, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P34
- `U72: a leaver whose exit is blocked by an inbound join posts the exit once the remaining participants' finalized block consumes the join, with no self-removal dispute`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P33, REQ-LIF-10-QR8NQ9.T1.P12
- `U72: blocks finalized while the exit's snapshot post runs queue one more post after it when that post did not land the exit, and the next finalized block posts again`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P35
- `U72: a leaver whose exit the remaining participants post while it sees no further block settles the leave, and the leave watchdog starts no self-removal dispute`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P29, REQ-LIF-10-QR8NQ9.T1.P17
- `U72: disposing a leaver whose exit is blocked stops its posts: the block that consumes the join sends nothing from it`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P30
- `U72: a dispute observed while the leave awaits its leave turn makes the leaver submit its self-removal dispute at once, with no evidence comparison and before the leave watchdog; the leave completes only on the reduced snapshot that drops it`: REQ-LIF-10-QR8NQ9.T1.P18
- `U72: a dispute observed after an exit block the application authored with no leave call makes the leaver submit its self-removal dispute at once, with no evidence comparison; the reduced snapshot drops it and its runtime is SYNCED with the self-removal still set`: REQ-LIF-10-QR8NQ9.T1.P19, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P37
- `U72: an exit block the application authored with no leave call is posted the same way: a later finalized block's post lands it once the join is consumed, and the runtime ends SYNCED with onLeftChannel, the self-removal still set and no dispute`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P36, REQ-LIF-10-QR8NQ9.T1.P21
- `U72: a block finalized while the exit's snapshot post runs queues no further post when that post lands the exit: the leaver sends once and posts no more`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P44
- `U72: a chain refusal of the exit's snapshot post reaches the leave's logger with its custom error and is not fatal: the next finalized block posts again`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P42, REQ-LIF-10-QR8NQ9.T1.P24
- `U72: an exit post that fails with an error that is no chain refusal is a fatal runtime error`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P43, REQ-LIF-10-QR8NQ9.T1.P25
- `U72: a leave of a pending join the chain has not shown re-arms the leave watchdog at each expiry with no dispute, and the join's expiry ends the leave and cancels the watchdog`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P38, REQ-TJOIN-7-NNGTAY.T1.P12
- `U72: a reduction that replaces the fork of an exit block the application authored with no leave call by a state that still seats the leaver restarts the exit there as a requested leave: its leave turn comes, self-removal stays set and its exit settles`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P39
- `U73: a latest-state request to a responder past its initial load that has not installed the chain's fork → refused for that fork, requester not blacklisted`: REQ-SYNC-1-T2589H.T2.P1, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P42
- `U73: a latest-state request to a responder whose own fork is behind the chain-derived fork → served from the derived fork, neither side blacklisted`: REQ-SYNC-1-T2589H.T2.P2, UNIT-TEST-SPECTATE-SERVICE-1-SJBYCT.P43
- `RO2: seating a join during its deadline membership read prevents a stale dispute request`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P46, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P72
- `RO2: the block bound passing while the deadline awaits membership requests only one dispute`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P47
- `RO2: reduction seats the pending join on a successor fork while its old deadline read is held`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P48
- `disposing a joiner while its force-join check is held at its membership read and another check waits behind it submits no dispute and emits no membership event`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P83
- `disposing a joiner while its force-join deadline setup is held at its participant-count read arms no join timer once the setup continues`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P84
- `AO4: a force-join deadline reads a real expired evidence window and retains the pending join without submitting`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P49, INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P9, INV-TJOIN-2-H7JSQM.T1.P7, INV-TJOIN-2-H7JSQM.T2.P10, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P70
- `U74: observing its own join arms the force-join deadline at once, one full turn window per pending turn, while the counting grace still runs`: INV-TJOIN-2-H7JSQM.T2.P1, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P35
- `U74: a submitted join not yet observed on chain starts neither force-join bound while blocks arrive`: INV-TJOIN-2-H7JSQM.T2.P2, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P36
- `U74: the force-join deadline passing with no new block requests the force-join dispute`: INV-TJOIN-2-H7JSQM.T2.P3, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P37
- `U75a: a delayed on-chain observation starts the deadline and the counting grace at observation, not at submission`: INV-TJOIN-2-H7JSQM.T2.P4, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P38, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P71, REQ-SDK-ARCH-1-7H14H6.T1.P8
- `U75b: an uncertain join that never reaches the chain → the join stays pending until the chain passes its authorization deadline, then the runtime leaves to SYNCED`: INV-TJOIN-2-H7JSQM.T2.P11, REQ-LIF-10-QR8NQ9.T1.P23, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P73, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P41, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P77, REQ-SDK-ARCH-1-7H14H6.T1.P14
- `U75c: a pending joiner whose join never lands → its leave waits for the join and settles back to SYNCED once the authorization expired on chain`: REQ-LIF-10-QR8NQ9.T2.P2, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P24
- `U75d: a join observed during the leave's join wait turns the leave into a member's leave`: REQ-LIF-10-QR8NQ9.T2.P3, UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P25
- `U75e: a leaving joiner whose landed join a founder's timeout dispute reduces away while the chain still lists it → once the chain drops it, its force-join check starts no dispute and lowers it to SYNCED with one onLeftChannel`: REQ-LIF-10-QR8NQ9.T2.P4, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P81
- `U75f: a pending joiner whose uncertain join can still land handles a snapshot event that does not list it → it stays PENDING_PARTICIPANT with its join open`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P18
- `U75g: a finally refused first join emits onLeftChannel once and does not abort; a later join of the same runtime refused for its expired authorization emits its onLeftChannel before onAbort, each once`: UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P40, REQ-LIF-10-QR8NQ9.T1.P22
- `U75h: a join authorization expiry timer that fires while the joiner's clock is still at or before the deadline arms the expiry timer again → once the chain passes the deadline the unlanded join ends SYNCED with one onLeftChannel`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P88
- `U76: blocks committed during the agreementTime grace after the joiner observes its join are not counted; counting starts at the first block after it`: INV-TJOIN-2-H7JSQM.T2.P6, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P40
- `U130: a leave of another topic during the handoff → the join still rematches on its own topic`: REQ-LOBBY-9-N894C0.T1.P27
- `U130: a new join after a leave during the handoff → its failed negotiation rematches again`: REQ-LOBBY-9-N894C0.T1.P29
