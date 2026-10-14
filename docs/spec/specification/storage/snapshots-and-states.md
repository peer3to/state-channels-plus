# Snapshot and State-Machine-State Stores

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The modules holding state snapshots and encoded state-machine states, and the derived
> read paths that join them with the block store. Shared storage rules:
> [durability.md](./durability.md).

## Contents

- [Purpose and data model](#purpose-and-data-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and data model

Two content-addressed stores and the joins over them:

- **Snapshot store.** Snapshots keyed by snapshot hash, plus a genesis index: fork id → that fork's
  genesis snapshot (fork id being the hash of the genesis snapshot data,
  [history-and-commitments.md](../protocol-model/history-and-commitments.md)).
- **State-machine-state store.** Encoded application states keyed by their hash
  (`stateMachineStateHash`).
- **Derived reads.** Coordinate lookups resolve through the block store: the snapshot at (fork,
  height) is the snapshot whose hash the stored block commits to; negative height resolves to the
  fork's genesis snapshot; a fork's genesis application state resolves through the genesis
  snapshot's state hash. The participant union at a coordinate is the union of the previous
  snapshot's and the resulting snapshot's participant sets.

## Requirements and invariants

**<a id="inv-snapstore-1-dphpje"></a>`INV-SNAPSTORE-1-DPHPJE` — Content addressing.** A snapshot or encoded state is stored and retrieved only
under its commitment hash; the store never recomputes, reinterprets, or substitutes content. A
caller-supplied key is trusted to equal the content hash only to the extent the producer's pipeline
guarantees it — the store's contract is exact-key fidelity.

**<a id="req-snapstore-1-ajw0hj"></a>`REQ-SNAPSTORE-1-AJW0HJ` — Genesis index consistency.** The genesis index maps a fork id to exactly the
genesis snapshot whose data hashes to that fork id; registering a fork's genesis is idempotent and a
conflicting registration for an existing fork id MUST be refused. A genesis is identified by how it
enters the store, not by its data alone: a snapshot stored as a block's resulting snapshot is never a
genesis, at any height, even when its data hashes to its fork id (a block that changes no state; block
0 shares height 0 with the genesis). It is stored by its hash and leaves the index unchanged, without a
warning, whether or not the fork's genesis is already registered. Any other stored snapshot is a
genesis when it is at block height 0 and its data hashes to its fork id; a later-height snapshot with
the same data is stored by its hash only, without a warning. A registration conflicts when its
snapshot differs from the registered one; the fork id pins the snapshot data and both are at height 0,
so only the timestamp can differ. The first registration stays. A refusal is not reported to the
storing caller and is logged as a warning; the refused snapshot is still stored by its hash.

**<a id="req-snapstore-2-q7e6tq"></a>`REQ-SNAPSTORE-2-Q7E6TQ` — Derived reads fail explicitly.** Coordinate-based reads return nothing when any
link of the join is absent (no block, no committed snapshot, no stored state). Negative heights
resolve to fork genesis; the store never fabricates intermediate results to satisfy a join. The
participant-union read presumes its join links exist — an invariant the pipeline maintains, not
this store: participants commit history contiguously, and a synced peer persists the state proof's
finalized anchor blocks before suffix replay, so an absent link is unreachable through any
designed flow.

## Assumptions and constraints

- Commitment relationships (block → snapshot hash → state hash) are defined by the protocol model;
  this module stores each level and performs the joins, proving nothing about them.
- Encoded states can be large; retention follows the shared obligation rules
  ([durability.md](./durability.md), [`REQ-STOR-4-MF6FT6` (Obligation-bounded retention)](durability.md#req-stor-4-mf6ft6)).

## Security considerations

These stores back state proofs, sync serving, and dispute audit. Substituted content under a stale
key would break every downstream commitment check — exact content addressing is the defense. Derived
reads that silently bridged gaps would let an incomplete local view masquerade as a proven one;
explicit-failure joins prevent that.

## Verification and test plan

### Requirement test matrix

| Plan item                                                         | Requirements / invariants                                                  | Setup and stimulus                                                                                                                                                                                                                                                   | Expected result                                                                                                                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-snapstore-1-dphpje.t1"></a>`INV-SNAPSTORE-1-DPHPJE.T1` | [`INV-SNAPSTORE-1-DPHPJE`](snapshots-and-states.md#inv-snapstore-1-dphpje) | Store and read snapshots and states by hash, including repeated stores.                                                                                                                                                                                              | Exact round trips; repeated stores idempotent; absent keys return nothing.                                                                                                                        | <a id="inv-snapstore-1-dphpje.t1.p1"></a>`INV-SNAPSTORE-1-DPHPJE.T1.P1` — snapshot store round trip; <a id="inv-snapstore-1-dphpje.t1.p2"></a>`INV-SNAPSTORE-1-DPHPJE.T1.P2` — repeated store; <a id="inv-snapstore-1-dphpje.t1.p3"></a>`INV-SNAPSTORE-1-DPHPJE.T1.P3` — absent key; <a id="inv-snapstore-1-dphpje.t1.p4"></a>`INV-SNAPSTORE-1-DPHPJE.T1.P4` — state store round trip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| <a id="req-snapstore-1-ajw0hj.t1"></a>`REQ-SNAPSTORE-1-AJW0HJ.T1` | [`REQ-SNAPSTORE-1-AJW0HJ`](snapshots-and-states.md#req-snapstore-1-ajw0hj) | Register fork geneses, repeat, attempt a conflicting genesis for a known fork id, store a later-height snapshot with the genesis data, and store a block's resulting snapshot with the genesis data at height 0, before and after the genesis.                       | Idempotent registration; conflicting registration refused with the original intact, logged, and still stored by hash; a block result or a later-height snapshot never registers and logs nothing. | <a id="req-snapstore-1-ajw0hj.t1.p1"></a>`REQ-SNAPSTORE-1-AJW0HJ.T1.P1` — register/read; <a id="req-snapstore-1-ajw0hj.t1.p2"></a>`REQ-SNAPSTORE-1-AJW0HJ.T1.P2` — idempotent repeat; <a id="req-snapstore-1-ajw0hj.t1.p3"></a>`REQ-SNAPSTORE-1-AJW0HJ.T1.P3` — conflict refused, the first registration stays; <a id="req-snapstore-1-ajw0hj.t1.p4"></a>`REQ-SNAPSTORE-1-AJW0HJ.T1.P4` — refused genesis still stored by, and the store returns, its hash; <a id="req-snapstore-1-ajw0hj.t1.p5"></a>`REQ-SNAPSTORE-1-AJW0HJ.T1.P5` — refusal logged as one warning naming both snapshots; <a id="req-snapstore-1-ajw0hj.t1.p6"></a>`REQ-SNAPSTORE-1-AJW0HJ.T1.P6` — a later-height snapshot with the genesis data is stored by hash, leaves the index unchanged and logs nothing; <a id="req-snapstore-1-ajw0hj.t1.p7"></a>`REQ-SNAPSTORE-1-AJW0HJ.T1.P7` — a later-height snapshot with the genesis data stored into an empty index does not register, and the height-0 genesis then registers; <a id="req-snapstore-1-ajw0hj.t1.p8"></a>`REQ-SNAPSTORE-1-AJW0HJ.T1.P8` — a height-0 block result with the genesis data stored after the genesis is stored by hash, leaves the index unchanged and logs nothing; <a id="req-snapstore-1-ajw0hj.t1.p9"></a>`REQ-SNAPSTORE-1-AJW0HJ.T1.P9` — a height-0 block result with the genesis data stored into an empty index does not register, and the genesis stored after it registers without a warning. |
| <a id="req-snapstore-1-ajw0hj.t2"></a>`REQ-SNAPSTORE-1-AJW0HJ.T2` | [`REQ-SNAPSTORE-1-AJW0HJ`](snapshots-and-states.md#req-snapstore-1-ajw0hj) | Integration: a peer that holds the fork genesis commits a block 0 that changes no state; a peer with no genesis of that fork synchronizes from a proof that finalizes such a block 0; a peer that holds the genesis applies the same synchronization response again. | The installed genesis stays the registered genesis; the block 0 result is stored by its hash; no refusal is logged for the block result or for an identical repeat.                               | <a id="req-snapstore-1-ajw0hj.t2.p1"></a>`REQ-SNAPSTORE-1-AJW0HJ.T2.P1` — committing an unchanged block 0 keeps the registered genesis and logs no refusal; <a id="req-snapstore-1-ajw0hj.t2.p2"></a>`REQ-SNAPSTORE-1-AJW0HJ.T2.P2` — a synchronization whose proof finalizes an unchanged block 0, applied with an empty index, registers the served genesis, stores the block 0 result by hash and logs no refusal; <a id="req-snapstore-1-ajw0hj.t2.p3"></a>`REQ-SNAPSTORE-1-AJW0HJ.T2.P3` — the same synchronization response applied twice keeps the registered genesis and logs no refusal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| <a id="req-snapstore-2-q7e6tq.t1"></a>`REQ-SNAPSTORE-2-Q7E6TQ.T1` | [`REQ-SNAPSTORE-2-Q7E6TQ`](snapshots-and-states.md#req-snapstore-2-q7e6tq) | Perform coordinate reads with each join link present and absent, including negative heights and participant unions.                                                                                                                                                  | Complete joins resolve; any missing link returns nothing; genesis resolution and unions are exact.                                                                                                | <a id="req-snapstore-2-q7e6tq.t1.p1"></a>`REQ-SNAPSTORE-2-Q7E6TQ.T1.P1` — full join; <a id="req-snapstore-2-q7e6tq.t1.p2"></a>`REQ-SNAPSTORE-2-Q7E6TQ.T1.P2` — absent block; <a id="req-snapstore-2-q7e6tq.t1.p3"></a>`REQ-SNAPSTORE-2-Q7E6TQ.T1.P3` — negative height → genesis; <a id="req-snapstore-2-q7e6tq.t1.p4"></a>`REQ-SNAPSTORE-2-Q7E6TQ.T1.P4` — participant union across a membership change equals previous ∪ resulting (join links present by pipeline invariant); <a id="req-snapstore-2-q7e6tq.t1.p5"></a>`REQ-SNAPSTORE-2-Q7E6TQ.T1.P5` — absent snapshot; <a id="req-snapstore-2-q7e6tq.t1.p6"></a>`REQ-SNAPSTORE-2-Q7E6TQ.T1.P6` — absent encoded state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Future Work

_Non-normative._ Deduplicated large-state storage once the disk medium lands.
