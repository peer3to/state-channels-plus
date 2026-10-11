# MembershipService.test.ts

Test file: [test/unit/MembershipService.test.ts](../../../../../../test/unit/MembershipService.test.ts)
Exercises: [MembershipService.ts](../../../../implementation/source/src/stateManager/membership/MembershipService.ts.md)

## Overview

The suite verifies the shared first-join and top-up owner used by direct signer calls and targeted connect.
It verifies that transaction submission establishes local pending protection before the receipt. A failed
receipt restores `SYNCED`; failures observed while the transaction is pending do not abort the runtime.
Later block inclusion remains separate from transaction submission and receipt handling.

Pending or participating callers with no balance send no transaction. Top-ups send once and wait for the
receipt. Force-join cases check the admission flag at the triggering block, then wait for detached dispute
construction to reach its recorded submission. Deferred cases retain their retry marker and submit nothing.

The two repeat-join cases reject a second `joinChannel` on a pending or participating runtime and prove the
runtime keeps its status and stays undisposed; the later-sync-failure angle of the same requirement is owned by
the targeted-join E2E suite. The unopened-refresh case maps to its own refresh permutation.

These cases contribute to `REQ-TJOIN-2-MFWADG` and `REQ-TJOIN-5-Q795M7`.

Cached source checks are optimistic. Misses refresh once, including concurrent misses. Tests also cover failed reads, reset, committed off-chain additions and observed slashes during a refresh.

Three refresh cases run with a real JOIN pending on chain that peer 0's storage and local diamond
already applied. After a cache reset, the refresh returns `true`, the snapshot participants and the
joiner are eligible again, and the local diamond's inbound head equals the chain's. A snapshot
participant whose spectate responses fail relays a real block after the reset; the receiver admits it
from the refresh alone, sends it no sync request, and keeps it connected and off the blacklist. A
one-shot revert of the local diamond's snapshot update makes the refresh throw instead of returning
`false`.

Two refresh cases fail a log the refresh recovers from the chain. Peer 0 loses the live delivery of a
real slash's logs (or of a top-up's inbound log), and the local diamond's next slash write (or inbound
application) reverts once. The refresh rejects with the local EVM revert instead of returning `false`.

Four refresh cases stage the local diamond against live logs. Its inbound applications are held while
a JOIN lands and peer 0 refreshes, then released with the live log's call first or the refresh's call
first: neither order reverts, the JOIN block is stored, and the inbound head and deposit total equal
the chain's. Two top-ups by peer 1, the first one's log lost by the local diamond, leave a block
missing below its head; the refresh stores it and the head stays at the chain's. A refresh held after
its chain read while peer 0 posts a newer snapshot leaves the local diamond at the chain's snapshot.

Three cases record a pending joiner's chain calls. Its refresh makes exactly one multicall and no
other call: the refresh applies its inbound run to the local diamond, whose pending set then answers
the pending check. Applying the chain snapshot through the spectate service reads only the snapshot
when the joiner's local diamond holds its JOIN. When the local diamond missed the JOIN log for good,
it reads the snapshot and the pending set once each. Both cases first confirm that the joiner's local state
does not list it, so the snapshot's departure check reaches its pending lookup.

Four cases read the membership lookups on real signers next to the chain's seated and pending sets. A
joiner whose local mirror missed its JOIN for good, while the chain lists it pending, runs a join check
after a snapshot application: the mirror-only lookup answers false, the chain-confirmed pending lookup
answers true, and the join keeps no force-join counting start. A seated participant that no pending set
lists is not pending on chain but is on chain. The joiner that its mirror missed is on chain from the
chain's pending set alone.

## Tests

- `an authoritative slash survives failed slash log recovery and repeated lookups`: none
- `unavailable inbound recovery leaves cached membership unchanged and does not blacklist the source`: none
- `the storage-clear event clears chain, off-chain and slashed eligibility`: none
- `an unopened channel refresh has no eligible source`: REQ-GOSSIP-4-J5Z4DF.T1.P25, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P34
- `a slash observed during a held refresh cannot be undone by its older result`: REQ-GOSSIP-4-J5Z4DF.T1.P20, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P15
- `a committed off-chain addition during refresh is eligible when the chain result misses it`: REQ-GOSSIP-4-J5Z4DF.T1.P19, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P16
- `an unseen slash does not force a read on an existing positive cache hit`: REQ-GOSSIP-4-J5Z4DF.T1.P17, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P17
- `current membership is an O(1) cached hit with no chain or VM reads`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P20
- `equivalent address casing uses the same cached identity`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P21
- `an unknown source refreshes once and remains absent`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P22
- `concurrent cache misses share one refresh and decide from chain membership`: none
- `reset removes both cached sets until a verified chain refresh`: REQ-GOSSIP-4-J5Z4DF.T1.P24, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P25
- `a refresh while the local diamond holds a pending JOIN applies its inbound block again as a no-op and applies the snapshot`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P51, UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P12, REQ-GOSSIP-4-J5Z4DF.T1.P38
- `the live log's application of an inbound block, then the refresh's, stores it once without a revert`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P13, REQ-GOSSIP-4-J5Z4DF.T1.P41
- `the refresh's application of an inbound block, then the live log's, stores it once without a revert`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P14
- `a refresh fills an inbound block the local diamond misses below its head without moving the head back`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P15, REQ-GOSSIP-4-J5Z4DF.T1.P42
- `a refresh read before a live snapshot update does not overwrite that newer snapshot in the local diamond or in membership`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P16, REQ-GOSSIP-4-J5Z4DF.T1.P43, REQ-MIRROR-2-E9F3TM.T1.P6, UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P21
- `a pending joiner's refresh makes only its pinned multicall chain call`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P17, UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P19, REQ-GOSSIP-4-J5Z4DF.T1.P44
- `a pending joiner whose local diamond holds its JOIN applies a snapshot without a pending-set chain read`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P19, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P72, REQ-SDK-ARCH-1-7H14H6.T1.P9
- `a pending joiner whose local diamond misses its JOIN reads the pending set from the chain once`: UNIT-TEST-EVENT-HANDLER-1-RZ2C7W.P20, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P73, REQ-SDK-ARCH-1-7H14H6.T1.P10
- `a pending JOIN the chain lists but the joiner's local mirror misses is not observed locally and starts no force-join counters`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P70, REQ-SDK-ARCH-1-7H14H6.T1.P7
- `a seated participant absent from the mirror's and the chain's pending sets is not pending on chain`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P74
- `a participant seated on chain with no pending entry is on chain`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P75
- `a joiner pending on chain and missed by its local mirror is on chain`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P76
- `a snapshot participant unknown to the cache while a JOIN is pending is admitted, not blacklisted`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P52, REQ-GOSSIP-4-J5Z4DF.T1.P39
- `a local diamond failure during a refresh throws instead of reporting the refresh unavailable`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P53, REQ-GOSSIP-4-J5Z4DF.T1.P40
- `a local diamond failure applying a recovered slash log during a refresh throws instead of reporting the refresh unavailable`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P67, UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P18, REQ-GOSSIP-4-J5Z4DF.T1.P45
- `a local diamond failure applying a recovered inbound log during a refresh throws instead of reporting the refresh unavailable`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P68, UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P19, REQ-GOSSIP-4-J5Z4DF.T1.P46
- `a delivered join event makes a pending-only sender a cache hit`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P26
- `a pushed snapshot preserves unconsumed pending JOINs without a membership read`: REQ-GOSSIP-4-J5Z4DF.T1.P33, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P30
- `already-open join forwards supplied and default balances with an internal deadline`: none
- `finite matchmaking timeout does not settle a first-join receipt wait`: none
- `finite matchmaking timeout does not settle a top-up receipt wait`: none
- `pending participant without balance sends zero transactions and returns true`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P2, REQ-TJOIN-3-DCZKS6.T1.P4
- `pending participant with balance sends one top-up transaction and returns true after its receipt`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P3, REQ-TJOIN-3-DCZKS6.T1.P5
- `participating signer without balance sends zero transactions and returns true`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P4
- `participating signer with balance sends one top-up transaction and returns true after its receipt`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P5
- `marks PENDING_PARTICIPANT before invoking join submission`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P10, INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P3, INV-TJOIN-2-H7JSQM.T1.P3
- `a duplicate first join while submission is pending shares the running submission`: none
- `direct joinChannel receipt failure restores SYNCED`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P1
- `uncertain join submission preserves pending protection`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P11, INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P4, INV-TJOIN-2-H7JSQM.T1.P4
- `direct joinChannel revert after pending preserves the channel`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P6, REQ-TJOIN-5-Q795M7.T1.P13
- `direct joinChannel revert after participating preserves the channel`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P7, REQ-TJOIN-5-Q795M7.T1.P14
- `replayed after the joiner is already PARTICIPATING → rejected on status, membership untouched`: none
- `a synced non-participant tops up → rejected on status`: none
- `no recorded join submission height → nothing disputed`: none
- `force join waits for its JOIN to land and submits only once at the block bound`: UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P50, INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P8, INV-TJOIN-2-H7JSQM.T1.P6, INV-TJOIN-2-H7JSQM.T2.P9, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P71
- `U77: after the agreementTime grace, fires exactly at the first counted block + participants + 1`: INV-TJOIN-2-H7JSQM.T2.P7, UNIT-TEST-CHANNEL-JOIN-SERVICE-1-BJKHEB.P41
- `a clean leave everyone signed → snapshot path, force-exit flag kept`: none
