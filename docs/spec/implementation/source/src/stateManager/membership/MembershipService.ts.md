# MembershipService.ts

> **Source:** [src/stateManager/membership/MembershipService.ts](../../../../../../../src/stateManager/membership/MembershipService.ts)

## Requirements

- [`REQ-SDK-ARCH-1-7H14H6` (Explicit ownership)](../../../../../specification/runtime/sdk.md#req-sdk-arch-1-7h14h6)
- [`REQ-TJOIN-3-DCZKS6` (Verified synchronization and membership)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-AUTH-5-BQG9AG` (Post-authentication engagement follows the local lifecycle)](../../../../../specification/peer-communication/synchronization.md#req-auth-5-bqg9ag)
- [`REQ-DISPUTE-PIPE-8-BVR8XV` (Dispute admission orders block signatures)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)
- [`REQ-MSGSTORE-1-6ME9D7` (Content-addressed store with tip tracking)](../../../../../specification/storage/message-blocks.md#req-msgstore-1-6me9d7)

## UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF

Source eligibility and membership facts

- Setup: Hold, fail or race the pinned chain membership read and its log recovery; deliver join events, slashes and snapshots; read membership for real and absent sources. For consolidation, exercise the membership owner and the join-observation, snapshot-departure and expiry/drop caller boundaries with a real signer locally pending, pending only on chain, seated only on chain, or absent from both chain sets
- Oracle: Consolidated membership reads preserve local-only timing, local-first confirmation on absence, and direct-chain seated-plus-pending semantics without new caches or outage fallback: `isSignerPendingInMirror` reads only the local mirror, `isSignerPendingOnChain` reads the mirror first and confirms absence on chain, and `isSignerOnChain` reads the chain's seated and pending sets. Cached hits make no read; one refresh is shared by concurrent misses; a slash cannot be undone by an older result; a chain search that does not return a needed log returns `false`; a failed chain read or local application rejects; reset clears every cached set

- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P15` — a slash observed during a held refresh cannot be undone by its older result
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P16` — a committed off-chain addition during refresh is eligible when the chain result misses it
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P17` — an unseen slash does not force a read on an existing positive cache hit
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P20` — current membership is an O(1) cached hit with no chain or VM reads
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P21` — equivalent address casing uses the same cached identity
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P22` — an unknown source refreshes once and remains absent
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P25` — reset removes both cached sets until a verified chain refresh
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P26` — a delivered join event makes a pending-only sender a cache hit
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P30` — publishing a real snapshot preserves unconsumed pending JOINs and performs no membership read
- [ ] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P31` — concurrent cache misses share one refresh and decide from chain membership
- [ ] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P32` — unavailable inbound recovery leaves cached membership unchanged and does not blacklist the source
- [ ] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P33` — the storage-clear event clears chain, off-chain and slashed eligibility
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P34` — an unopened channel refresh on a fresh runtime has no eligible source
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P51` — a refresh while the local diamond already holds a pending JOIN returns `true` and makes the snapshot participants and the pending joiner eligible again
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P52` — a snapshot participant missing from the cache while a JOIN is pending is admitted by the refresh, with no spectate sync and no blacklist, even when its sync would fail
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P53` — a local diamond failure in the refresh's direct application (its snapshot write) throws; a chain search that does not return a needed log returns `false`, while a failed chain read rejects
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P67` — a local diamond failure while the refresh applies a slash log it recovered from the chain rejects the refresh with that failure, not `false`
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P68` — a local diamond failure while the refresh applies an inbound log it recovered from the chain rejects the refresh with that failure, not `false`
- [ ] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P69` — a failed secondary pending-set read in the apply step (the pinned set does not list the signer) rejects the refresh instead of returning `false`; kept by engineer decision (2026-10-10), RPC redundancy is planned

- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P70` — local-only join observation stays absent while the chain lists a pending join but the local mirror does not; no early force-join counters
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P71` — local-only join observation starts force-join counters when the local mirror lists the pending signer
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P72` — departure protection finds the signer locally pending and needs no chain pending read
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P73` — departure protection finds no local pending signer but confirms it pending on chain and does not declare departure
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P74` — departure protection's pending lookup (`isSignerPendingOnChain`) answers false for a real signer that neither the local mirror's nor the chain's pending set lists
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P75` — the direct-chain lookup of the expiry/drop checks (`isSignerOnChain`) answers true for a real peer seated on chain with no pending entry
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P76` — the direct-chain lookup of the expiry/drop checks (`isSignerOnChain`) answers true for a real joiner pending on chain that its local mirror misses
- [x] `UNIT-TEST-MEMBERSHIP-SERVICE-1-EDFKZF.P77` — the direct-chain expiry/drop check finds the signer in neither chain set and permits the existing expiry/drop decision
