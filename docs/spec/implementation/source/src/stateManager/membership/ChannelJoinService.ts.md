# ChannelJoinService.ts

> **Source:** [src/stateManager/membership/ChannelJoinService.ts](../../../../../../../src/stateManager/membership/ChannelJoinService.ts)
>
> **Design views:** [join channel](../../../../views/architecture/sdk/rpc/join-channel.md), [dispute pipeline](../../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-SDK-ARCH-1-7H14H6` (Explicit ownership)](../../../../../specification/runtime/sdk.md#req-sdk-arch-1-7h14h6)
- [`INV-MEMBERSHIP-PENDING-1-2H1T75` (Submitted joins are locally pending before acknowledgement)](../../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75)
- [`INV-TJOIN-2-H7JSQM` (Local pending protection for submitted joins)](../../../../../specification/peer-communication/targeted-channel-join.md#inv-tjoin-2-h7jsqm)
- [`REQ-TJOIN-3-DCZKS6` (Verified synchronization and membership)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6)
- [`REQ-TJOIN-5-Q795M7` (Phase-specific failure)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7)
- [`REQ-JOINSIG-1-8X1A4V` (Pinned-state authorization)](../../../../../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)

## UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB

Own join, top-up and force join

- Setup: Drive first join, force-join eligibility, pending/participating reuse, and top-up through public signer paths; around a real chain snapshot move, hold or fail submissions, receipts, threshold countersignatures and the chain snapshot read; hold or delay the JOIN observation and the evidence window; hold fresh retry collection across the old deadline, stale queued checks and disposal; hold an expiry check after its chain-membership read answered absent, or run one while the refused submission's retry-eligibility read is held; land a concurrent join first so the threshold set widens; land a spectator's join while a top-up is held at its send; request a leave through the public `leaveChannel` before the own force-join dispute and remove the join from the local state and the chain before or after that dispute; overlap two top-up calls; dispose during a held join check or a held force-join deadline setup, with a record-only scheduling probe
- Oracle: Pending starts before contract invocation; only final proven no-commitment failure ends the logical join `SYNCED`; the internal retry preserves pending status and promise without an intermediate onLeftChannel: the refused record is retired before the retry-eligibility read, so a queued check stops at its entry and a check already past an awaited read stops at its re-check of the active record before it drops the membership, records an observation or arms a timer; an expired unobserved join that the chain does not list ends `SYNCED`; force join waits for on-chain membership and a usable dispute window and starts one dispute at the exact block bound or deadline; committed reuse without a balance sends zero transactions, and a join or top-up sends one submission plus at most one more, only after a proven failure while the chain snapshot moved from a stored pin to a stored snapshot or after a refusal for a threshold set a landed join widened; overlapping top-up calls share one submission; a failed attempt is told apart from a funded success, and a successful retry credits the requested amount exactly once; a fresh collection that fails ends the call `false` with no second submission; an observed join that both the local state and the chain omit ends `SYNCED` with one onLeftChannel and no dispute of its own after the drop; a check released after disposal sends no dispute, emits no membership event and schedules no join timer; a terminal-revert abort shows the restored `SYNCED` as a status transition, because the abort's own `OPENED` would otherwise mask it

- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P1` — failed receipt restores `SYNCED`
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P2` — pending no-balance reuse
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P3` — pending full-balance top-up
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P4` — participating no-balance reuse
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P5` — participating full-balance top-up
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P6` — failure after pending preserves attachment
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P7` — failure after participating preserves attachment
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P8` — pending fault then failed receipt restores `SYNCED` without abort
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P9` — pending fault then successful receipt produces on-chain pending membership and an inbound join message
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P10` — local pending is observable before contract invocation
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P11` — uncertain submission keeps pending status and the pending join
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P35` — Observation of the own JOIN immediately arms the full participant-count-plus-one timeout delay before height grace expires
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P36` — Join submission alone followed by four blocks arms neither deadline nor height counting
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P37` — The observed-join deadline triggers one dispute without any new block being produced
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P38` — Delayed JOIN observation starts grace and the full timeout bound from observation rather than submission
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P40` — Blocks inside observation grace do not count; the first later block starts counting and bound minus one sends no dispute
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P41` — At the force-join height bound one dispute starts, while bound minus one does not
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P43` — With participant timeout checks suppressed and no block after the JOIN, the joiner time bound opens a dispute and seats it by reduction, followed by on-chain membership adoption
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P44` — A mined JOIN whose observation is held starts neither height grace nor force-join deadline; releasing observation arms exactly one full participant-count-plus-one writer-window deadline and starts height grace no earlier than observation plus agreementTime
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P45` — Four blocks inside JOIN observation grace start neither counting nor dispute; four blocks after grace trigger the omitted-join dispute, whose real reduction seats the joiner
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P46` — seating a join during its deadline membership read prevents a stale dispute request
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P47` — the block bound wins while the deadline awaits membership and only one dispute is requested
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P48` — reduction seats the pending join on a successor fork while its old deadline read is held
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P49` — a force-join deadline reads a real expired evidence window and retains the pending join without submitting
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P50` — force join waits for its JOIN to land and submits only once at the block bound
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P54` — a first join whose proven failure follows a snapshot move to a stored snapshot is collected again once and submitted once more; the second submission lands and the call returns `true`
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P55` — a first join whose receipt fails with no decoded race while the snapshot moved to a stored one also gets the one retry, collects one fresh confirmation, and is admitted after two submissions
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P56` — a second proven non-race failure of the one retry is final: `false` after two submissions and one fresh collection, the runtime `SYNCED`, no abort
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P57` — an uncertain first-join submission (no receipt, no decoded revert) while the snapshot moved to a stored one is not retried: `false` after one submission, no fresh collection, `PENDING_PARTICIPANT` kept, no abort
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P58` — a move to a chain snapshot the runtime has not stored gives no retry, with the pending-joiner snapshot guard held off: no fresh collection, and the join fails on its race
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P59` — a pin the runtime never stored gives no retry: no fresh collection, and the join fails on its race
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P60` — a first join whose fresh collection for the one retry fails (a threshold member refuses its countersignature) returns `false` with no second submission; the runtime becomes `SYNCED` and does not abort
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P61` — a top-up whose snapshot moves to a stored one before it lands is collected again once with the original amount; the call returns `true` and the chain credits the requested amount exactly once
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P62` — a top-up whose snapshot moves again before its one retry lands returns `false` and keeps `PARTICIPATING`, with no abort
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P63` — a top-up that fails proven while the snapshot stays at its pin is not retried: `false` after one submission, `PARTICIPATING` kept
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P64` — a top-up whose fresh collection for the one retry fails returns `false` with no second submission and keeps `PARTICIPATING`
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P66` — an uncertain top-up submission while the snapshot moved to a stored one is not retried: `false` after one submission, `PARTICIPATING` kept
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P70` — An expired real evidence window keeps the observed join tracked and starts no dispute
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P71` — A delayed JOIN keeps the join tracked before inclusion; the later block bound starts one dispute and a repeated check starts none
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P72` — Normal block seating ends the join; an in-flight deadline check cannot start a dispute afterwards
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P73` — a submitted join not observed when its authorization expires on chain, and not listed by the chain, ends: the runtime is `SYNCED` with no dispute, and the leave service emits `onLeftChannel` once

- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P74` — hold fresh retry collection after a proven stored-snapshot race: the public promise stays pending, status stays pending and no onLeftChannel or intermediate rejection is exposed; release to success with at most two submissions
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P75` — hold a successful fresh collection past the refused attempt’s old deadline and release stale queued checks: neither ends the logical join or emits onLeftChannel, and the fresh submission uses its own deadline
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P76` — end or dispose the logical join while fresh collection is held, then release it: no later funded submission occurs
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P77` — fresh retry collection finally fails: the one public call returns false, the runtime becomes SYNCED with one membership-end event and no abort or second submission
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P78` — a first join refused because a join that landed first widened the threshold set (`ErrorJoinChannelConfirmationNotThresholdSigned`) is collected again once, with the new pending participant's countersignature, and submitted once more: the call returns `true`, the joiner is on-chain pending, with no abort, no onLeftChannel and no intermediate `SYNCED`
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P79` — two first joins collected concurrently on one table: the one that lands first is submitted once; the other is refused for the widened threshold set and lands on its one retry, whose fresh collection the first joiner countersigns once; both end on-chain pending and `PENDING_PARTICIPANT` with no abort and no onLeftChannel
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P80` — a leave requested through the public `leaveChannel` before the joiner's own force-join dispute puts its self-removal into that dispute; once the reduction consumed the join and both the installed local state and the chain omit the joiner, the join ends: `SYNCED`, one onLeftChannel, the tracked join cleared, no leave watchdog armed again, and the runtime disposes itself
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P81` — an observed join that a reduction drops locally and the chain drops before the force-join dispute is due: the due force-join check requests no dispute, and the join ends `SYNCED` with one onLeftChannel and the tracked join cleared
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P82` — overlapping `topUpBalance` calls with one prepared request share the running top-up: one funded submission, one credit of the amount, and the same result for both calls
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P83` — disposal while a force-join check is held at its membership read and another check is queued: once released, no dispute reaches the chain and no dispute, status or membership event is emitted
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P84` — a join check released after disposal arms no join timer
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P85` — an expiry check that already read the chain's absent membership after the old deadline resumes while the refused submission's fresh collection is held: it ends nothing, the public promise stays pending, the status stays pending with no onLeftChannel, and the one retry lands
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P86` — an expiry check that runs after the old deadline while the refused submission's retry-eligibility read is held ends nothing: the public promise stays pending, the status stays pending with no onLeftChannel, and the one retry lands
- [x] `UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P87` — a top-up refused because a join that landed first widened the threshold set (`ErrorJoinChannelConfirmationNotThresholdSigned`) is collected again once, with the new pending participant's countersignature, and submitted once more: the call returns `true` after two submissions, the chain credits the amount once and `PARTICIPATING` is kept
