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

## Tests

- `an authoritative slash survives failed slash log recovery and repeated lookups`: none
- `unavailable inbound recovery leaves cached membership unchanged and does not blacklist the source`: none
- `the storage-clear event clears chain, off-chain and slashed eligibility`: none
- `an unopened channel refresh has no eligible source and retains no old-channel positives`: REQ-GOSSIP-4-J5Z4DF.T1.P25, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P34
- `a slash observed during a held refresh cannot be undone by its older result`: REQ-GOSSIP-4-J5Z4DF.T1.P20, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P15
- `a committed off-chain addition during refresh is eligible when the chain result misses it`: REQ-GOSSIP-4-J5Z4DF.T1.P19, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P16
- `an unseen slash does not force a read on an existing positive cache hit`: REQ-GOSSIP-4-J5Z4DF.T1.P17, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P17
- `current membership is an O(1) cached hit with no chain or VM reads`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P20
- `equivalent address casing uses the same cached identity`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P21
- `an unknown source refreshes once and remains absent`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P22
- `concurrent cache misses share one refresh and decide from chain membership`: none
- `a failed provider read leaves cached members intact and allows a later retry`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P24
- `reset removes both cached sets until a verified chain refresh`: REQ-GOSSIP-4-J5Z4DF.T1.P24, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P25
- `a delivered join event makes a pending-only sender a cache hit`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P26
- `a pushed snapshot preserves unconsumed pending JOINs without a membership read`: REQ-GOSSIP-4-J5Z4DF.T1.P33, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P30
- `already-open join forwards supplied and default balances with an internal deadline`: none
- `finite matchmaking timeout does not settle a first-join receipt wait`: none
- `finite matchmaking timeout does not settle a top-up receipt wait`: none
- `pending participant without balance sends zero transactions and returns true`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P2, REQ-TJOIN-3-DCZKS6.T1.P4
- `pending participant with balance sends one top-up transaction and returns true after its receipt`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P3, REQ-TJOIN-3-DCZKS6.T1.P5
- `participating signer without balance sends zero transactions and returns true`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P4
- `participating signer with balance sends one top-up transaction and returns true after its receipt`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P5
- `marks PENDING_PARTICIPANT before invoking join submission`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P10, INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P3, INV-TJOIN-2-H7JSQM.T1.P3
- `rejects a duplicate first join while submission is pending`: none
- `direct joinChannel receipt failure restores SYNCED`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P1
- `uncertain join submission preserves pending protection`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P11, INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P4, INV-TJOIN-2-H7JSQM.T1.P4
- `direct joinChannel revert after pending preserves the channel`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P6, REQ-TJOIN-5-Q795M7.T1.P13
- `direct joinChannel revert after participating preserves the channel`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P7, REQ-TJOIN-5-Q795M7.T1.P14
- `replayed after the joiner is already PARTICIPATING → rejected on status, membership untouched`: none
- `a synced non-participant tops up → rejected on status`: none
- `no recorded join submission height → nothing disputed`: none
- `force join waits for its JOIN to land and submits only once at the block bound`: UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P50, INV-MEMBERSHIP-PENDING-1-2H1T75.T1.P8, INV-TJOIN-2-H7JSQM.T1.P6, INV-TJOIN-2-H7JSQM.T2.P9, UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P6
- `U77: after the agreementTime grace, fires exactly at the first counted block + participants + 1`: INV-TJOIN-2-H7JSQM.T2.P7, UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P41
- `a clean leave everyone signed → snapshot path, no force-exit flag`: none
- `I did not leave → returns without scheduling an exit`: none
