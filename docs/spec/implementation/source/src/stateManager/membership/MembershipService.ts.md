# MembershipService.ts

> **Source:** [src/stateManager/membership/MembershipService.ts](../../../../../../../src/stateManager/membership/MembershipService.ts)
>
> **Design views:** [join channel](../../../../views/architecture/sdk/rpc/join-channel.md)

## Requirements

- [`INV-MEMBERSHIP-PENDING-1-2H1T75` (Submitted joins are locally)](../../../../../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75)
- [`INV-TJOIN-2-H7JSQM` (Local pending protection for submitted joins)](../../../../../specification/peer-communication/targeted-channel-join.md#inv-tjoin-2-h7jsqm)
- [`REQ-TJOIN-3-DCZKS6` (Verified synchronization and membership)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6)
- [`REQ-TJOIN-5-Q795M7` (Phase-specific failure)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-AUTH-5-BQG9AG` (Post-authentication engagement follows the local lifecycle)](../../../../../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag)
- [`REQ-DISPUTE-PIPE-8-BVR8XV` (Dispute admission orders block signatures)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)

## UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF

Submitted-pending membership and committed reuse

- Setup: Drive first join, force-join eligibility, pending/participating reuse, and top-up through public signer paths
- Oracle: Pending starts before contract invocation; only proven no-commitment failure restores `SYNCED`; force join waits for authoritative eligibility and submits once at the exact trigger height; committed reuse sends zero or one transaction; a terminal-revert abort shows the restored `SYNCED` as a status transition and a cleared force-join submission height, because the abort's own `OPENED` would otherwise mask both cleanup effects

- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P1` — failed receipt restores `SYNCED`
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P2` — pending no-balance reuse
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P3` — pending full-balance top-up
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P4` — participating no-balance reuse
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P5` — participating full-balance top-up
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P6` — failure after pending preserves attachment
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P7` — failure after participating preserves attachment
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P8` — pending fault then failed receipt restores `SYNCED` without abort
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P9` — pending fault then successful receipt produces on-chain pending membership and an inbound join message
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P10` — local pending is observable before contract invocation
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P11` — uncertain submission preserves pending status and force-join marker
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P12` — force join defers while membership is absent and while the window is expired, then submits exactly once after later eligibility
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P13` — force join does not submit one block early and submits exactly once at `joinSubmissionHeight + current participant count + 1`
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P14` — a join rejected for a threshold shortfall (`ErrorJoinChannelConfirmationNotThresholdSigned`) restores `SYNCED`, clears the force-join marker and aborts the state manager rather than leaving the join retryable
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P15` — a slash observed during a held refresh cannot be undone by its older result
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P16` — a committed off-chain addition during refresh is eligible when the chain result misses it
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P17` — an unseen slash does not force a read on an existing positive cache hit
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P20` — current membership is an O(1) cached hit with no chain or VM reads
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P21` — equivalent address casing uses the same cached identity
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P22` — an unknown source refreshes once and remains absent
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P24` — a failed provider read leaves cached members intact and allows a later retry
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P25` — reset removes both cached sets until a verified chain refresh
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P26` — a delivered join event makes a pending-only sender a cache hit
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P30` — publishing a real snapshot preserves unconsumed pending JOINs and performs no membership read
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P31` — concurrent cache misses share one refresh and decide from chain membership
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P32` — unavailable inbound recovery leaves cached membership unchanged and does not blacklist the source
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P33` — the storage-clear event clears chain, off-chain and slashed eligibility
- [ ] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P34` — an unopened channel refresh has no eligible source and retains no old-channel positives
