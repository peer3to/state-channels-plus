# E2E-JoinSnapshotGuard.test.ts

Test file: [test/e2e/E2E-JoinSnapshotGuard.test.ts](../../../../../../test/e2e/E2E-JoinSnapshotGuard.test.ts)

## Overview

Holds a joiner's join or top-up submissions at their send, has the participants finalize and post a newer snapshot, and releases one held submission at a time. With no move, a prepared join through the public `joinChannel` route is admitted. On the public route, a single move to a snapshot the joiner stores is followed by one fresh join that lands: the call returns `true`, the joiner is on-chain pending without abort, and a static replay of the stale confirmation still reverts with `RaceConditionJoinChannelSnapshotMismatch`. Through `connectToChannel` with `shouldJoin`, one move also ends with the joiner pending and no abort; a second move before that retry lands is followed by another fresh join, and the third held submission lands with the joiner pending and no abort; on a channel whose maximum participant count is four, a move before each of five submissions (the first and four retries) ends the call `false` with an abort, the founders answered exactly five collections, and the joiner is in neither membership set; a failed receipt with no move leaves the joiner `SYNCED`, not aborted and not admitted. A joiner made blind to block confirmations sees a chain-only move to a snapshot it does not store, aborts, and is admitted to neither membership set; the call may reject once the runtime is disposed. A participant's top-up through `connectToChannel` with a balance whose snapshot moves to a stored one is submitted twice, returns `true`, and the chain's `InboundMessagesProcessed` logs carry exactly one JOIN for it with the requested amount.

The retry-boundary cases count submissions through the membership stubs (`getHeldMembershipReceiptCount`) and fresh collections through the founders' join countersignature request counts. When one threshold member refuses the retry's countersignature, a first join returns `false` with one submission, ends `SYNCED` and does not abort, and a top-up returns `false` with one submission and keeps `PARTICIPATING`. An uncertain submission (no receipt, no decoded revert) after a move keeps `PENDING_PARTICIPANT` with one submission and no fresh collection. A top-up whose snapshot moves again is collected again and lands on its third held submission, the chain credits the amount once and it keeps participating; a top-up whose receipt fails with no move returns `false` after one submission. A joiner blind to gossip whose snapshot events are held sees a move to a snapshot it has not stored only through the retry predicate, and a join pinned to a made-up hash: both collect nothing fresh and fail on their race. A failed receipt with no decoded race after a move gets one fresh collection and lands after two submissions; when that retry's receipt fails too, the call returns `false` after two submissions, `SYNCED`, with no abort.

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

Four cases race three synced spectators (`raceJoinPastTwoLandingJoins`). The joiner's connect submission is
held; the first spectator's join lands, the joiner's submission is released and refused for the widened set,
and its retry is held; the second spectator's join then lands. In the first case the held retry is released,
refused for the set the second widened, and a third submission is held and then lands: the call returns
`true` after three submissions, the second collection asked the first joiner once and the third asked each of
the two landed joiners once, all three joiners are on-chain pending without abort, and the joiner is
`PENDING_PARTICIPANT` with no `onLeftChannel`. On the code with one retry it fails: the second refusal aborts
the joiner and no third submission comes. In the second and third cases the channel's maximum participant count is five,
so the second landed join fills it: the held retry is refused for too many participants, and the call returns
`false` after two submissions, the landed joiners answer no further request, and the two landed joiners fill
the on-chain membership. By default the joiner aborts once; with `shouldSpectateWhenFull` it is `SYNCED`
without abort with one `onLeftChannel`.
A fourth case stages the default race and holds the joiner's retry decision at its entry
(`holdJoinRetryDecision`). The decision is entered once, for `ErrorTooManyParticipants`; while it is held the
participants move the chain snapshot to one the joiner stores, then the decision is released. The call still
returns `false` after two submissions, the landed joiners answer no further request, and the joiner aborts
once. Without the full-channel check at the start of the retry decision it fails: the moved snapshot makes
the refusal look like a snapshot race, and a third collection and submission follow.

Two cases connect a synced spectator with a join to a channel whose maximum participant count is three, so
the three founders already fill it. The founders answer no countersignature request, the chain's
`InboundMessagesProcessed` logs carry no JOIN for the joiner, and connect returns `false`. By default the
joiner aborts once; on the code without the full-channel check the founders answer three requests. With
`shouldSpectateWhenFull` the joiner is `SYNCED` without abort, and after the founders finalize one more block
it is in sync with them. A third case uses a maximum of four: a second spectator's join lands first, and
just before the connect the chain lists it as pending and not seated, with three seated participants. The
threshold set answers no countersignature request, no JOIN lands for the joiner, connect returns `false`,
and the joiner aborts once.

One case submits a prepared join through the public `joinChannel` to a channel of four seats that the three
founders and one landed pending join fill; the confirmation is built after that join landed. The join is
still submitted once (held at its send, then released), and the held retry decision records the refusal as
`ErrorTooManyParticipants`. The call returns `false` (or rejects), `onLeftChannel` fires once before the one
`onAbort`, the held submission count stays one, and the chain's `InboundMessagesProcessed` logs carry no JOIN for
the joiner. Without the full-channel case in `onJoinRefused` it fails: no abort follows.

One case holds participant 0's top-up submissions on a channel of four seats and meets each held submission
with a snapshot move to a stored one before releasing it. After five submissions (the first and four
retries) the call returns `false`, the two other founders answered ten countersignature requests in total,
the participant is still `PARTICIPATING` without abort, and the chain logs carry no JOIN for it. Without the
cap in the top-up retry loop it fails: a sixth collection and submission follow.

One case aborts a joiner while its retry's submission is pending. The connect's first held submission meets
a snapshot move and is refused; the retry is the second held submission, and a second move makes its pin
stale. One host-side timeout-manager task (`abortReleasingMembershipSubmission`) then aborts the runtime and
releases the held retry, which is refused on its stale pin; the runtime's teardown drains that task until the
refusal was handled. The call returns `false`, the only status change after the abort is `OPENED`, `onAbort`
fired once, and the joiner is not pending. Without the disposal check before the refusal handling it fails:
the refusal handling sets `SYNCED` after the abort's `OPENED`.

One case aborts a participant while its top-up's fresh confirmation is collected. A prepared top-up meets a
snapshot move to a stored one before it is called, so its submission is refused on the stale pin; the retry's
fresh collection is held once it has collected, and the top-up's promise is recorded
(`holdJoinCollectionResult`). One host-side timeout-manager task (`abortReleasingJoinCollectionResult`) then
aborts the runtime and releases the collection; the runtime's teardown drains that task until the recorded
top-up settled. Once the runtime is closed the call returns
`false` (or rejects), `onAbort` fired once, and the chain's `InboundMessagesProcessed` logs carry no JOIN for
the participant. Without the disposal check after the fresh collection it fails: the retry is submitted and
the call returns `true`.

One case overlaps two `connectToChannel` calls with `shouldJoin` and the same balance on one synced
spectator. The first call's collection is held at its on-chain threshold read, before any countersignature
request; the second call is sent, and the case waits until a record-only stub on the joiner's
`collectAndJoinChannel` (`recordCollectAndJoinEntries`) counted it as the second entry. Released,
both calls return `true`, each threshold member answered one countersignature request, the chain's
`InboundMessagesProcessed` logs carry one JOIN for the joiner, and it is `PENDING_PARTICIPANT`. Without the
shared join promise it fails: the second call collects and submits its own join, and the first then rejects
because the runtime is no longer `SYNCED`.

Four cases fail the first join or top-up submission with a mined, failed receipt that carries no revert data
(`failMembershipReceipt` with `once` and `isReplayPassing`): nothing is sent, and the replay of the same call
runs on the real chain and passes. In two, the submission again lands: the call returns `true` after two
counted submissions, the threshold members answered one collection, and the chain's
`InboundMessagesProcessed` logs carry one JOIN of the requested amount. In the other two, the submission
again is held after its gas estimate (`holdFirstJoinSendAfterEstimate`, for `topUpBalance` in the top-up case)
while another spectator's join lands and widens the threshold set; released, it is mined and reverts with no
data, its replay names the threshold refusal, the fresh collection is countersigned once by the newly landed
joiner, and the third submission lands: `true`, three counted submissions, one JOIN of the requested amount,
the join `PENDING_PARTICIPANT` (the top-up `PARTICIPATING`) and no abort. With the earlier replay that sent
the transaction again itself, the first two count one submission and the last two end `false`.

Two more cases fail every join or top-up submission that way (`failMembershipReceipt` with
`isReplayPassing`, without `once`) on a channel of four seats. Each passing replay is one more retry, so the call
returns `false` after five counted submissions (the first and four retries); the threshold members answered one
collection, and the chain logs carry no JOIN. The joiner ends `SYNCED` and the participant keeps
`PARTICIPATING`, both with no abort. With a cap check that allows one more retry it fails: six submissions
are counted.

## Tests

- `E42 control: a join prepared against snapshot S with no snapshot update before execution passes the snapshot guard and the joiner is admitted`: REQ-MSG-10-7JS45Q.T2.P1
- `E42: a join prepared against snapshot S and held at its send while a real snapshot update lands is prepared again once against the stored new snapshot, and the joiner is admitted`: REQ-MSG-10-7JS45Q.T2.P3, REQ-TJOIN-5-Q795M7.T1.P21
- `a connect's join whose snapshot moves to a stored one before it lands is prepared again once against that snapshot and the joiner is admitted`: REQ-TJOIN-5-Q795M7.T1.P15, REQ-JOINSIG-1-8X1A4V.T1.P5, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P54
- `a connect's join whose snapshot moves again before its retry lands is collected again and lands on its third submission: the joiner is admitted with no abort`: REQ-TJOIN-5-Q795M7.T1.P25, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P97
- `a connect's join refused on a moved snapshot at every submission stops retrying at the channel's maximum participant count: after that many retries connect returns false, the joiner aborts, and no further confirmation is collected`: REQ-JOINSIG-1-8X1A4V.T1.P20, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P94
- `a connect's join that fails while the snapshot stays put is not retried: the joiner is back to SYNCED and not admitted`: REQ-TJOIN-5-Q795M7.T1.P17
- `a join whose snapshot moves to one this joiner does not store is not prepared again: the join fails and the joiner aborts`: REQ-TJOIN-5-Q795M7.T1.P18
- `a top-up whose snapshot moves to a stored one before it lands is prepared again once against that snapshot and lands`: REQ-JOINSIG-1-8X1A4V.T1.P6, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P61
- `a connect's join whose fresh confirmation for its retry cannot be collected returns false with no second submission, and the joiner stays SYNCED`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P60, REQ-TJOIN-5-Q795M7.T1.P22, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P77, REQ-JOINSIG-1-8X1A4V.T1.P11
- `a top-up whose fresh confirmation for its retry cannot be collected returns false with no second submission, and the participant keeps participating`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P64, REQ-JOINSIG-1-8X1A4V.T1.P7
- `a join whose submission outcome is uncertain while the snapshot moved to a stored one is not prepared again: it keeps PENDING_PARTICIPANT after one submission`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P57, REQ-TJOIN-5-Q795M7.T1.P23
- `a top-up whose snapshot moves again before its retry lands is collected again and lands on its third submission: the amount credited once and the participation kept`: REQ-JOINSIG-1-8X1A4V.T1.P22, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P96
- `a top-up refused on a moved snapshot at every submission stops retrying at the channel's maximum participant count: after that many retries it returns false, no further confirmation is collected, and the participation is kept with no abort`: REQ-JOINSIG-1-8X1A4V.T1.P24, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P106
- `a top-up that fails while the snapshot stays put is not retried: it returns false after one submission and keeps the participation`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P63
- `a top-up whose submission outcome is uncertain while the snapshot moved to a stored one is not prepared again: it returns false after one submission and keeps the participation`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P66
- `a join whose snapshot moves to one this joiner has not stored is not prepared again: no fresh confirmation is collected and the join fails on its race`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P58
- `a join pinned to a snapshot this joiner never stored is not prepared again: no fresh confirmation is collected and the join fails on its race`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P59
- `a join whose receipt fails without a decoded race while the snapshot moved to a stored one is prepared again once and the joiner is admitted`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P55
- `a join whose retry after a snapshot move fails again on a failed receipt with no further move is final: it returns false after two submissions and the joiner stays SYNCED`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P56
- `a join whose fresh retry collection is held past the refused attempt's authorization deadline stays one pending join: the refused attempt's expiry check ends nothing, no onLeftChannel is emitted, and the retry lands under its own deadline`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P74, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P75, REQ-JOINSIG-1-8X1A4V.T1.P8, REQ-JOINSIG-1-8X1A4V.T1.P9
- `a join whose expiry check already read the chain's absent membership when the submission is refused stays one pending join: the check resumes during the held fresh collection and ends nothing, and the retry lands`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P85
- `a join whose expiry check runs while the refused submission's retry-eligibility read is in flight stays one pending join: the check ends nothing, and the retry lands`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P86
- `a join disposed while the fresh confirmation for its retry is being collected submits nothing more once the collection continues: no JOIN lands for the joiner`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P76, REQ-JOINSIG-1-8X1A4V.T1.P10
- `a top-up whose runtime aborts once the fresh confirmation for its retry is collected submits nothing more: the call returns false and no JOIN lands for the participant`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P102, REQ-JOINSIG-1-8X1A4V.T1.P23
- `two synced spectators whose first joins race on one table both end pending: the join that lands second is refused for the threshold set the first widened and lands on its retry, whose fresh collection the first joiner countersigns`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P79, REQ-JOINSIG-1-8X1A4V.T1.P13
- `two synced spectators whose joins race on one table both end pending when the second's transaction is estimated before the first lands and mined after it: the mined refusal for the widened threshold set is collected again, countersigned by the first, and lands with no abort`: REQ-JOINSIG-1-8X1A4V.T1.P27, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P110
- `a connect's join whose mined submission reverts with no revert data while its replay at the latest block passes is submitted again with the same confirmation and lands: true after two submissions, one collection, one JOIN on chain, and no abort`: REQ-JOINSIG-1-8X1A4V.T1.P28, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P111
- `a connect's join whose mined submission reverts with no revert data while its replay passes is submitted again, and that resubmission, estimated before another join lands and mined after it, is refused for the widened threshold set: it is collected again, countersigned by the landed joiner, and lands on its third submission with no abort`: REQ-JOINSIG-1-8X1A4V.T1.P29, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P112
- `a connect's join whose mined submission keeps reverting with no revert data while its replay keeps passing stops at the channel's maximum participant count of retries: false after that many retries plus the first submission, one collection, no JOIN on chain, and the joiner back to SYNCED with no abort`: REQ-JOINSIG-1-8X1A4V.T1.P32, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P115
- `a join refused twice for threshold sets that two joins landing one after another widened is collected again each time and lands on its third submission: each fresh collection asks the newly landed joiners, and no abort`: REQ-JOINSIG-1-8X1A4V.T1.P19, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P93
- `a connect's join to a channel already full is neither collected nor submitted: connect returns false and the joiner aborts`: REQ-JOINSIG-4-3NBKHK.T1.P1, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P98
- `a connect's join with shouldSpectateWhenFull to a channel already full is neither collected nor submitted: connect returns false, and the joiner stays SYNCED with no abort and follows the next block`: REQ-JOINSIG-4-3NBKHK.T1.P2, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P99
- `a connect's join to a channel that a pending participant fills is neither collected nor submitted: connect returns false and the joiner aborts`: REQ-JOINSIG-4-3NBKHK.T1.P4, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P101
- `a join whose retry after a threshold set refusal is refused because a second landed join filled the channel ends on that refusal: connect returns false after two submissions with no further collection, and the joiner aborts`: REQ-JOINSIG-1-8X1A4V.T1.P21, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P95
- `a join whose retry is refused because a second landed join filled the channel is not retried even when the snapshot moves to a stored one before the retry is decided: connect returns false after two submissions with no further collection, and the joiner aborts`: REQ-JOINSIG-4-3NBKHK.T1.P7, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P105
- `a join with shouldSpectateWhenFull whose retry after a threshold set refusal is refused because a second landed join filled the channel ends on that refusal: connect returns false after two submissions with no further collection, and the joiner is back to SYNCED with no abort`: REQ-JOINSIG-4-3NBKHK.T1.P3, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P100
- `a prepared join submitted to a channel that a landed pending join fills makes no full-channel read and is refused for too many participants: joinChannel returns false after one submission, onLeftChannel then onAbort fire once each, and no JOIN lands for the joiner`: REQ-JOINSIG-4-3NBKHK.T1.P6, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P104
- `a join refused and retried once, whose runtime aborts while the retry's submission is held at its send, handles no refusal of that submission: connect rejects with RootDisposedError, and the status stays OPENED`: REQ-JOINSIG-1-8X1A4V.T1.P18, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P92
- `a participant's top-up held at its send while a spectator's join lands is refused for the threshold set that join widened, collected again once with the new pending participant's countersignature, and lands: two submissions, the amount credited once, and the participation kept`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P87, REQ-JOINSIG-1-8X1A4V.T1.P14
- `a top-up whose mined submission reverts with no revert data while its replay at the latest block passes is submitted again with the same confirmation and lands: true after two submissions, one collection, the amount credited once, and the participation kept`: REQ-JOINSIG-1-8X1A4V.T1.P30, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P113
- `a top-up whose mined submission reverts with no revert data while its replay passes is submitted again, and that resubmission, estimated before a spectator's join lands and mined after it, is refused for the widened threshold set: it is collected again, countersigned by the new pending participant, and lands on its third submission with the amount credited once`: REQ-JOINSIG-1-8X1A4V.T1.P31, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P114
- `a top-up whose mined submission keeps reverting with no revert data while its replay keeps passing stops at the channel's maximum participant count of retries: false after that many retries plus the first submission, one collection, no JOIN on chain, and the participation kept with no abort`: REQ-JOINSIG-1-8X1A4V.T1.P33, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P116
- `concurrent topUpBalance calls with one prepared request: the second call reuses the running top-up, so one funded submission credits the amount once and both calls return the same result`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P82
- `concurrent connect joins on one synced spectator: the second call gets the running join's promise, so one collection and one funded submission land the join and both calls return true`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P103, REQ-JOINSIG-4-3NBKHK.T1.P5
