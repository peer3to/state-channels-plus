# System 2 — Off-Chain Execution and Block Progression

> **Agent status:** Maintained system contract (non-normative navigation; normative authority lives in
> the owned documents below).
> **Engineer verification:** Pending.

This system turns peer and chain input into canonical local history: deterministic author selection,
state-machine transitions, block construction, the pre-execution intake/merge queue, confirmation and
signature collection, ordered execution, milestone construction, local persistence, and normal-path
recovery. It is the fast path of the protocol; everything it cannot resolve escalates to the disputes
system.

## System contract

- **Owned state.** The local canonical fork: stored blocks and confirmations with source attribution,
  the pre-execution queue, the live application state-machine instance, agreement/milestone progress,
  and the local persistence needed to restart without losing committed history.
- **Public inputs.** Block confirmations from peer ingress, chain-calldata events, local authoring,
  and replay/recovery; signature additions for known blocks; inbound message blocks due for
  inclusion.
- **Public outputs.** Committed local history and events describing it; counter-signatures broadcast
  to peers; milestones and signed suffixes consumed as state-proof material; escalation triggers into
  the disputes system; block-calldata publication when the cooperative window expires.
- **Calls.** Protocol model (execute transitions, compare commitments, select the next author, check
  timestamps); peer communication (broadcast confirmations, request missing data); settlement (apply
  inbound messages during block construction); disputes (escalate); enforcement via chain observation
  (post calldata).
- **Called by.** Peer communication (block-confirmation ingress is its sole peer entry); runtime
  (restart recovery); disputes (replay during audit re-uses the same validation pipeline).
- **Trust and availability assumptions.** Peer input is untrusted and arrives duplicated, unordered,
  and partially signed; chain observation is fresh within the trust model's RPC assumption; local
  storage is durable across restarts.
- **Ordering and concurrency.** Two regimes with a normative boundary: unordered concurrent
  intake/merge, and totally ordered serialized execution
  ([block-processing.md](./block-processing.md) `REQ-BLOCK-PIPE-5`/`REQ-BLOCK-PIPE-6`).
- **Invariants (owned).** `INV-BLOCK-PIPE-1`, `REQ-BLOCK-PIPE-1`–`REQ-BLOCK-PIPE-6`
  ([block-processing.md](./block-processing.md)).
- **Failure and recovery outcomes.** Every validation deviation is classified with a
  context-appropriate consequence (`REQ-BLOCK-PIPE-3`); missing data triggers bounded sync that
  re-enters the same pipeline (`REQ-BLOCK-PIPE-4`); objective violations produce fraud-proof evidence;
  liveness failures produce timeout-dispute eligibility after the windows defined in
  [../protocol-model/time.md](../protocol-model/time.md).
- **Resource bounds.** Pre-execution retention is bounded per entry; queue and retry budgets must
  prevent one fork or peer from starving unrelated work.
- **Verification evidence.** The requirement matrix in [block-processing.md](./block-processing.md);
  the ingress edge is proven under [`REQ-IX-1`](../interactions.md#req-ix-1) and the execution edge
  under [`REQ-IX-2`](../interactions.md#req-ix-2).

## Owned documents

| Document | Defines |
| --- | --- |
| [block-processing.md](./block-processing.md) | The complete intake → merge → order → validate → execute → commit pipeline, its concurrency boundary, and its recovery rules. |

Deterministic author selection is owned by
[../protocol-model/state-machines.md](../protocol-model/state-machines.md) (`REQ-SM-5`) and
[../protocol-model/finality.md](../protocol-model/finality.md) (`REQ-FIN-5`); milestone structure by
[../protocol-model/finality.md](../protocol-model/finality.md). This system consumes them.

## Interaction contracts

Producer of proof material for disputes ([`REQ-IX-4`](../interactions.md#req-ix-4)) and consumer of
peer ingress ([`REQ-IX-1`](../interactions.md#req-ix-1)), deterministic execution
([`REQ-IX-2`](../interactions.md#req-ix-2)), and inbound-inclusion obligations
([`REQ-IX-3`](../interactions.md#req-ix-3)).
