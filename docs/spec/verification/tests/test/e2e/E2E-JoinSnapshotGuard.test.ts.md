# E2E-JoinSnapshotGuard.test.ts

Test file: [test/e2e/E2E-JoinSnapshotGuard.test.ts](../../../../../../test/e2e/E2E-JoinSnapshotGuard.test.ts)

## Overview

Holds a joiner's join or top-up submissions at their send, has the participants finalize and post a newer snapshot, and releases one held submission at a time. With no move, a prepared join through the public `joinChannel` route is admitted. On the public route, a single move to a snapshot the joiner stores is followed by one fresh join that lands: the call returns `true`, the joiner is on-chain pending without abort, and a static replay of the stale confirmation still reverts with `RaceConditionJoinChannelSnapshotMismatch`. Through `connectToChannel` with `shouldJoin`, one move also ends with the joiner pending and no abort; a second move before that retry lands aborts the joiner with no membership; a failed receipt with no move leaves the joiner `SYNCED`, not aborted and not admitted. A joiner made blind to block confirmations sees a chain-only move to a snapshot it does not store, aborts, and is admitted to neither membership set; the call may reject once the runtime is disposed. A participant's top-up through `connectToChannel` with a balance whose snapshot moves to a stored one is submitted twice, returns `true`, and the chain's `InboundMessagesProcessed` logs carry exactly one JOIN for it with the requested amount.

The retry-boundary cases count submissions through the membership stubs (`getHeldMembershipReceiptCount`) and fresh collections through the founders' join countersignature request counts. When one threshold member refuses the retry's countersignature, a first join returns `false` with one submission, ends `SYNCED` and does not abort, and a top-up returns `false` with one submission and keeps `PARTICIPATING`. An uncertain submission (no receipt, no decoded revert) after a move keeps `PENDING_PARTICIPANT` with one submission and no fresh collection. A top-up whose snapshot moves again returns `false` and keeps participating; a top-up whose receipt fails with no move returns `false` after one submission. A joiner blind to gossip whose snapshot events are held sees a move to a snapshot it has not stored only through the retry predicate, and a join pinned to a made-up hash: both collect nothing fresh and fail on their race. A failed receipt with no decoded race after a move gets one fresh collection and lands after two submissions; when that retry's receipt fails too, the call returns `false` after two submissions, `SYNCED`, with no abort.

The failed-fresh-collection join case and the stay-put receipt failure also wait for the joiner's
`onLeftChannel` and assert exactly one. The logical-retry cases hold the retry's fresh collection at its
on-chain threshold read (`holdJoinThresholdRead`). In one, the joiner's authorization lasts 10 seconds and the
refused attempt's expiry task is held when armed; while the collection is held the chain passes that deadline
and the held expiry task runs. The join's public promise is still unsettled, the status is still
`PENDING_PARTICIPANT`, no `onLeftChannel` was emitted and the tracked join is marked retrying; released, the
retry is the second and last held submission, the call returns `true`, no status change since the call went
to `SYNCED`, and the tracked join carries a later deadline. In the other, the joiner's runtime is disposed
while the collection is held; the disposal releases the hold, the call ends `false` or rejects, and after a
five-second absence window the chain's `InboundMessagesProcessed` logs carry no JOIN for the joiner and
neither membership set lists it.

Two cases hold the refused attempt's expiry check at a later point. In the first, the expiry task runs
after the deadline passed on chain while the submission is still held, and the check's chain-membership
read is held after it answered `false`; the submission is released into a fresh collection held at its
threshold read, then the check's read is released. In the second, the refused submission's
retry-eligibility read (the chain snapshot read) is held, and the expiry task runs after the deadline
passed on chain. In both, after the join checks settle the public promise is unsettled, the status is
`PENDING_PARTICIPANT`, no `onLeftChannel` was emitted and the tracked join is retrying; released, the
retry is the second and last held submission, the call returns `true`, the joiner is on-chain pending
without abort or `onLeftChannel`, and no status change since the call went to `SYNCED`.

Two synced spectators connect with `shouldJoin` at once, each submission held at its send: the first lands
and enters the on-chain threshold set, the second's held submission is refused and its retry is its second
held submission; both return `true`, end on-chain pending and `PENDING_PARTICIPANT` without abort or
`onLeftChannel`, and the first joiner answered one countersignature request. Two `topUpBalance` calls with one
prepared request overlap while the first send is held; after a later call on the same signer port only one
submission entered the hold, both calls return `true`, and the chain credits the amount once. A
participant's prepared top-up is held at its send while a synced spectator's join lands and enters the
on-chain threshold set; the chain snapshot stays at the top-up's pin, and a static call of the held
top-up reverts with `ErrorJoinChannelConfirmationNotThresholdSigned`. Released, the top-up's retry is its
second and last held submission, the call returns `true`, the spectator answered one countersignature
request, the chain's `InboundMessagesProcessed` logs credit the amount once, and the participant is
still `PARTICIPATING` without abort.

## Tests

- `E42 control: a join prepared against snapshot S with no snapshot update before execution passes the snapshot guard and the joiner is admitted`: REQ-MSG-10-7JS45Q.T2.P1
- `E42: a join prepared against snapshot S and held at its send while a real snapshot update lands is prepared again once against the stored new snapshot, and the joiner is admitted`: REQ-MSG-10-7JS45Q.T2.P3, REQ-TJOIN-5-Q795M7.T1.P21
- `a connect's join whose snapshot moves to a stored one before it lands is prepared again once against that snapshot and the joiner is admitted`: REQ-TJOIN-5-Q795M7.T1.P15, REQ-JOINSIG-1-8X1A4V.T1.P5, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P54
- `a connect's join whose snapshot moves again before its one retry lands fails as a join with no retry does: the joiner aborts and is not admitted`: REQ-TJOIN-5-Q795M7.T1.P16
- `a connect's join that fails while the snapshot stays put is not retried: the joiner is back to SYNCED and not admitted`: REQ-TJOIN-5-Q795M7.T1.P17
- `a join whose snapshot moves to one this joiner does not store is not prepared again: the join fails and the joiner aborts`: REQ-TJOIN-5-Q795M7.T1.P18
- `a top-up whose snapshot moves to a stored one before it lands is prepared again once against that snapshot and lands`: REQ-JOINSIG-1-8X1A4V.T1.P6, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P61
- `a connect's join whose fresh confirmation for its one retry cannot be collected returns false with no second submission, and the joiner stays SYNCED`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P60, REQ-TJOIN-5-Q795M7.T1.P22, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P77, REQ-JOINSIG-1-8X1A4V.T1.P11
- `a top-up whose fresh confirmation for its one retry cannot be collected returns false with no second submission, and the participant keeps participating`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P64, REQ-JOINSIG-1-8X1A4V.T1.P7
- `a join whose submission outcome is uncertain while the snapshot moved to a stored one is not prepared again: it keeps PENDING_PARTICIPANT after one submission`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P57, REQ-TJOIN-5-Q795M7.T1.P23
- `a top-up whose snapshot moves again before its one retry lands returns false and keeps the participation`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P62
- `a top-up that fails while the snapshot stays put is not retried: it returns false after one submission and keeps the participation`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P63
- `a top-up whose submission outcome is uncertain while the snapshot moved to a stored one is not prepared again: it returns false after one submission and keeps the participation`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P66
- `a join whose snapshot moves to one this joiner has not stored is not prepared again: no fresh confirmation is collected and the join fails on its race`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P58
- `a join pinned to a snapshot this joiner never stored is not prepared again: no fresh confirmation is collected and the join fails on its race`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P59
- `a join whose receipt fails without a decoded race while the snapshot moved to a stored one is prepared again once and the joiner is admitted`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P55
- `a join whose one retry fails again on a failed receipt after a snapshot move is final: it returns false after two submissions and the joiner stays SYNCED`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P56
- `a join whose fresh retry collection is held past the refused attempt's authorization deadline stays one pending join: the refused attempt's expiry check ends nothing, no onLeftChannel is emitted, and the retry lands under its own deadline`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P74, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P75, REQ-JOINSIG-1-8X1A4V.T1.P8, REQ-JOINSIG-1-8X1A4V.T1.P9
- `a join whose expiry check already read the chain's absent membership when the submission is refused stays one pending join: the check resumes during the held fresh collection and ends nothing, and the one retry lands`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P85
- `a join whose expiry check runs while the refused submission's retry-eligibility read is in flight stays one pending join: the check ends nothing, and the one retry lands`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P86
- `a join disposed while the fresh confirmation for its one retry is being collected submits nothing more once the collection continues: no JOIN lands for the joiner`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P76, REQ-JOINSIG-1-8X1A4V.T1.P10
- `two synced spectators whose first joins race on one table both end pending: the join that lands second is refused for the threshold set the first widened and lands on its one retry, whose fresh collection the first joiner countersigns`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P79, REQ-JOINSIG-1-8X1A4V.T1.P13
- `a participant's top-up held at its send while a spectator's join lands is refused for the threshold set that join widened, collected again once with the new pending participant's countersignature, and lands: two submissions, the amount credited once, and the participation kept`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P87, REQ-JOINSIG-1-8X1A4V.T1.P14
- `concurrent topUpBalance calls with one prepared request: the second call reuses the running top-up, so one funded submission credits the amount once and both calls return the same result`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P82
