# Durable Storage and Recovery

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** What a participant node must keep durably, when durable state commits, how a restarted
> node recovers from it, when data may be pruned, and the integrity rules of the stores. Mechanisms
> that _produce_ the data own its meaning; this document owns its survival.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Durable data classes](#durable-data-classes)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

A participant's protocol obligations outlive its process. After a crash or restart, an honest node
must still be able to resume execution from its committed position, serve synchronization to peers,
detect and contest invalid on-chain actions within their windows, and complete any dispute or
recovery it had begun. Durable storage is the only local basis for all of that: whatever the protocol
may later require the node to _prove, replay, or contest_ must survive; whatever survives is still
untrusted input to the validation pipelines when it is read back.

## Durable data classes

| Class                        | Contents                                                                                                                                                                        | Producing owner                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Canonical history            | Committed blocks with their complete signature sets and source attribution; current fork identity; the committed application state or the data to rebuild it deterministically. | [Block progression](../block-progression/block-processing.md)                                |
| Agreement and proof material | Milestones, threshold context, and everything needed to construct or verify state proofs from the last final anchor.                                                            | [Protocol model](../protocol-model/finality.md), [state proofs](../disputes/state-proofs.md) |
| Cross-layer stream progress  | Applied inbound tip, produced outbound blocks, and the committed tips relied on for settlement.                                                                                 | [Settlement](../settlement/cross-layer-messages.md)                                          |
| Dispute evidence             | Auditing data, observed dispute state, and evidence preserved for open or contestable windows.                                                                                  | [Disputes](../disputes/dispute-processing.md)                                                |
| Deployment identity          | The channel's manager binding, configuration commitments, and encoding versions needed to interpret every other class.                                                          | [Configuration](../runtime/configuration.md)                                                 |

## Requirements and invariants

<a id="req-stor-1"></a>
**REQ-STOR-1 — Complete durable set.** A node MUST keep durably, per channel and fork, every datum in
the [durable data classes](#durable-data-classes) that a protocol obligation could still require:
resuming execution, serving verifiable synchronization, constructing state proofs, meeting
watchtower/contest duties within open windows, and completing begun disputes or recovery. Data whose
loss silently converts an honest node into one that cannot meet an obligation is in the durable set
by definition.

<a id="req-stor-2"></a>
**REQ-STOR-2 — Commit-aligned durability.** Durable writes commit atomically with the owning
operation's effect boundary: a block and its consequences commit together
([`INV-BLOCK-PIPE-1`](../block-progression/block-processing.md)); dispute evidence and actions
converge or stay retryable ([`REQ-DISPUTE-PIPE-4`](../disputes/dispute-processing.md)); temporary
work never reaches durable state without a successful commit
([`REQ-SDK-ARCH-4`](../runtime/sdk.md)). Observable events describe only durably committed transitions.

<a id="req-stor-3"></a>
**REQ-STOR-3 — Restart recovery without trust.** From its durable set plus chain observation alone, a
restarted node MUST re-derive its protocol position and resume. Every datum read back re-enters the
owning validation pipeline as untrusted input — storage grants persistence, never validity — and
recovery is bounded: it either converges to the committed position or fails explicitly; it MUST NOT
half-apply.

<a id="req-stor-4"></a>
**REQ-STOR-4 — Obligation-bounded retention.** Data MAY be pruned only when no protocol obligation
can still require it: the relevant windows (dispute, kill, challenge, contest) are expired, the
on-chain snapshot has advanced past it, and no synchronization or watchtower duty the node has
accepted still depends on it. Pruning MUST NOT remove evidence needed to contest within any window
that is still open or can still be opened against retained state.

<a id="req-stor-5"></a>
**REQ-STOR-5 — Isolation, integrity, and versioned encoding.** Stores are keyed by channel and fork;
one channel's data can neither shadow nor corrupt another's. Corruption MUST be detected and fail
closed — a node serves no data it cannot verify against its commitments. Stored encodings carry
enough version identity that a later software revision either reads them correctly or refuses
explicitly; silent reinterpretation is prohibited.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `REQ-STOR-1`            | Complete durable set. A node MUST keep durably, per channel and fork, every datum       |
| `REQ-STOR-2`            | Commit-aligned durability. Durable writes commit atomically with the owning operation   |
| `REQ-STOR-3`            | Restart recovery without trust. From durable state plus chain observation alone, resume |
| `REQ-STOR-4`            | Obligation-bounded retention. Prune only what no protocol obligation can still require  |
| `REQ-STOR-5`            | Isolation, integrity, and versioned encoding. Keyed stores, fail-closed corruption      |

## Assumptions and constraints

- The storage medium is durable across process restarts but not infallible: partial writes, torn
  state, and corruption are in scope; total media loss is not — a node that loses its durable set
  must recover as a re-synchronizing peer, not resume as if nothing happened.
- Storage capacity is finite; retention duties bound the minimum, pruning rules bound the growth.
- Durable state is local: nothing here weakens the chain's role as the arbiter, and locally stored
  data proves nothing to anyone else without the owning system's proofs.
- Platform storage APIs differ; the guarantees here are semantic and must hold on every supported
  platform ([`REQ-RUNTIME-4`](../runtime/execution.md)).

## Security considerations

Protected assets are the node's ability to prove, replay, and contest — losing them converts safety
guarantees into unenforceable claims. Threats include crash-window loss of commit-aligned state,
premature pruning that destroys contest evidence while a window is open, cross-channel/fork key
confusion, corrupted stores silently served to peers or pipelines, downgrade/upgrade
misinterpretation of stored encodings, and an adversary timing an attack to a victim's restart.
Recovery re-validation is the containment: stored data is untrusted at read-back, so a corrupted
store can deny service but cannot inject validity.

## Verification and test plan

### Requirement test matrix

| Plan item                                 | Requirements / invariants | Setup and stimulus                                                                                        | Expected result                                                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-stor-1-t1"></a>`REQ-STOR-1.T1` | `REQ-STOR-1`              | Restart a node after each protocol phase and demand each obligation (resume, sync-serve, prove, contest). | Every obligation is satisfiable from the durable set; no obligation silently becomes unsatisfiable.                        | <a id="req-stor-1-t1-p1"></a>`REQ-STOR-1.T1.P1` — resume mid-execution; <a id="req-stor-1-t1-p2"></a>`REQ-STOR-1.T1.P2` — serve sync after restart; <a id="req-stor-1-t1-p3"></a>`REQ-STOR-1.T1.P3` — build a state proof after restart; <a id="req-stor-1-t1-p4"></a>`REQ-STOR-1.T1.P4` — contest an invalid on-chain action begun before restart. |
| <a id="req-stor-2-t1"></a>`REQ-STOR-2.T1` | `REQ-STOR-2`              | Inject crashes at every durable-write boundary of block commit, dispute action, and stream progress.      | State is all-or-nothing at each boundary; events never describe uncommitted state; retries are idempotent.                 | <a id="req-stor-2-t1-p1"></a>`REQ-STOR-2.T1.P1` — crash before/inside/after each commit; <a id="req-stor-2-t1-p2"></a>`REQ-STOR-2.T1.P2` — torn multi-store operation; <a id="req-stor-2-t1-p3"></a>`REQ-STOR-2.T1.P3` — retry after each crash point.                                                                                              |
| <a id="req-stor-3-t1"></a>`REQ-STOR-3.T1` | `REQ-STOR-3`              | Restart from valid, stale, and manipulated durable sets with live and lagging chain views.                | Recovery converges or fails explicitly; read-back data is re-validated; manipulated stores inject nothing.                 | <a id="req-stor-3-t1-p1"></a>`REQ-STOR-3.T1.P1` — clean restart converges; <a id="req-stor-3-t1-p2"></a>`REQ-STOR-3.T1.P2` — stale store catches up via bounded sync; <a id="req-stor-3-t1-p3"></a>`REQ-STOR-3.T1.P3` — tampered store rejected by re-validation; <a id="req-stor-3-t1-p4"></a>`REQ-STOR-3.T1.P4` — repeated crash during recovery. |
| <a id="req-stor-4-t1"></a>`REQ-STOR-4.T1` | `REQ-STOR-4`              | Drive windows to open, contestable, and expired states, then prune.                                       | Only obligation-free data is pruned; contest within any open window still succeeds after pruning.                          | <a id="req-stor-4-t1-p1"></a>`REQ-STOR-4.T1.P1` — prune after full expiry; <a id="req-stor-4-t1-p2"></a>`REQ-STOR-4.T1.P2` — prune attempt with an open window refused; <a id="req-stor-4-t1-p3"></a>`REQ-STOR-4.T1.P3` — window boundary (at expiry); <a id="req-stor-4-t1-p4"></a>`REQ-STOR-4.T1.P4` — accepted sync/watchtower duty pins data.   |
| <a id="req-stor-5-t1"></a>`REQ-STOR-5.T1` | `REQ-STOR-5`              | Mix channels/forks in one node, corrupt stored entries, and read stores across encoding versions.         | Keys never collide across channels/forks; corruption fails closed; version mismatch reads correctly or refuses explicitly. | <a id="req-stor-5-t1-p1"></a>`REQ-STOR-5.T1.P1` — multi-channel/fork isolation; <a id="req-stor-5-t1-p2"></a>`REQ-STOR-5.T1.P2` — bit-level corruption detected; <a id="req-stor-5-t1-p3"></a>`REQ-STOR-5.T1.P3` — same-version round trip; <a id="req-stor-5-t1-p4"></a>`REQ-STOR-5.T1.P4` — newer/older encoding refused or migrated explicitly.  |

## Future Work

_Non-normative._ Portable store-format recommendations for cross-implementation recovery; pruning
policy presets per deployment class; encrypted-at-rest guidance for hosts where the platform does not
already provide it.
