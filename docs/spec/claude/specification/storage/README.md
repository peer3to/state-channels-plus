# System 9 — Storage

> **Agent status:** Maintained system contract (non-normative navigation; normative authority lives in
> the owned documents below).
> **Engineer verification:** Pending.

Storage is its own protocol system because nearly every other system reads and writes through it: it
holds the node's canonical local knowledge — blocks, snapshots, states, streams, evidence, queues,
and progress markers — behind module boundaries with defined keys, merge rules, and consistency
guarantees. The current realization is in-memory; disk persistence is a planned change of *medium*,
not of contract: every rule in this system is stated so that swapping the medium changes durability
strength, never observable semantics.

## System contract

- **Owned state.** All locally stored protocol data, organized as modules with disjoint key spaces:
  the block store, the pre-execution queue, message-block stores (one inbound, one outbound),
  snapshot and state-machine-state stores, participant-set change points, dispute and fraud-proof
  evidence, block-calldata records, timeout candidates, and progress/intent markers.
- **Public inputs.** Store, merge, and update operations from every producing system; every write
  carries data already validated by its producer to the degree the module's contract states —
  storage itself validates keys and merge rules, never protocol semantics.
- **Public outputs.** Reads: by content hash, by coordinates (fork, height, author), by linkage
  range, by index, and by tip pointer. Reads return what was stored or nothing; storage never
  fabricates, reorders, or reinterprets.
- **Calls.** Nothing — storage is a leaf. It performs no chain reads, no peer communication, and no
  state-machine execution.
- **Called by.** Block progression (blocks, queue, snapshots, states); settlement (message blocks,
  progress markers); disputes (dispute/fraud-proof evidence, timeouts, calldata); peer communication
  (attribution written through queue intake, sync served from stores); runtime (recovery reads
  everything back at restart).
- **Trust and availability assumptions.** Stored data is only as trustworthy as its producer's
  validation; read-back re-enters validation per [`REQ-STOR-3-4RJGER`](durability.md#req-stor-3-4rjger). The medium is
  currently process-lifetime memory: durability across restart is **not yet provided**, and every
  consumer obligation that presumes it (watchtower duties, restart recovery) is limited accordingly
  until the disk medium lands — see [durability.md](./durability.md), which specifies the target
  durability contract the medium change must satisfy.
- **Ordering and concurrency.** Module operations are atomic at the single-operation level; merge
  operations (signature sets, source attribution) are monotone and idempotent so concurrent and
  duplicate delivery converge. Cross-module consistency at an operation boundary is the *caller's*
  transaction, specified by [`REQ-STOR-2-TARP8S`](durability.md#req-stor-2-tarp8s).
- **Invariants (owned).** `REQ-STOR-*` ([durability.md](./durability.md)) plus the per-module
  requirements in the module documents below.
- **Failure and recovery outcomes.** A read of absent data returns nothing, never a default that
  masquerades as protocol state; a failed or partial multi-module write must be repairable per
  [`REQ-STOR-2-TARP8S`](durability.md#req-stor-2-tarp8s); corruption (once media can corrupt) fails closed per [`REQ-STOR-5-T6EQSA`](durability.md#req-stor-5-t6eqsa).
- **Resource bounds.** Per-entry structural caps where an adversary controls insertion volume (queue
  attribution caps); retention bounded by protocol obligations ([`REQ-STOR-4-MF6FT6`](durability.md#req-stor-4-mf6ft6)).
- **Verification evidence.** Test matrices in the owned documents; the cross-system storage edge is
  <a id="req-ix-9-av56nr"></a>`REQ-IX-9-AV56NR`.

## Owned documents

Shared rules first; each storage module then has its own specification. Shared behavior is stated
once in [durability.md](./durability.md) and not restated per module — a module document owns only
what is specific to that module: its key space, data model, merge/update rules, and read guarantees.

| Document | Module(s) | Defines |
| --- | --- | --- |
| [durability.md](./durability.md) | shared | Durable data classes, commit-aligned durability, restart recovery without trust, obligation-bounded retention, integrity and versioning. |
| [blocks.md](./blocks.md) | Block store | Dual keying (hash and fork/height), signature merge, tip tracking, deletion consistency, bounded traversal. |
| [queue.md](./queue.md) | Pre-execution queue | Queued-entry model, monotone signature/source attribution with structural caps, coordinate index, dequeue rules, fork clearing. |
| [message-blocks.md](./message-blocks.md) | Inbound & outbound message-block stores | Hash-linked stream storage, tip pointers, backward range reads. |
| [snapshots-and-states.md](./snapshots-and-states.md) | Snapshot store, state-machine-state store | Content-addressed snapshots and encoded states, genesis-by-fork index, the derived snapshot/state read paths. |
| [participant-changes.md](./participant-changes.md) | Participant-set change points | Membership-change heights per fork and ordered range reads for milestone-hop construction. |
| [dispute-evidence.md](./dispute-evidence.md) | Dispute store, fraud-proof store, dispute-fraud-proof store | Dispute confirmations with signature merge, disputed-fork and own-dispute flags, content-addressed proofs and their indexes. |
| [calldata-and-timeouts.md](./calldata-and-timeouts.md) | Block-calldata store, timeout store | Calldata records keyed by fork/height/author with exact-hash matching; lowest-height timeout candidate per fork. |
| [progress-markers.md](./progress-markers.md) | Event-sync, force-exit, force-join markers | Monotone chain-observation progress and local intent flags that survive across protocol phases. |

## Interaction contracts

Every system's storage use is governed by one edge: [`REQ-IX-9-AV56NR`](README.md#req-ix-9-av56nr) —
storage preserves exactly what producers committed, returns it unreinterpreted, and grants no
validity. Modules never call back into their producers.
