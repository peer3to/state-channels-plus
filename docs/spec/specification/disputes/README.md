# System 5 — Objective Fault Handling and Dispute Resolution

> **Agent status:** Maintained system contract (non-normative navigation; normative authority lives in
> the owned documents below).
> **Engineer verification:** Pending.

This system converts a stalled or contested off-chain fork into an objectively auditable base-layer
decision: validation and fraud-proof algorithms, the slash-set lifecycle, the four valid dispute
inputs, state-proof construction and audit, the dispute-window lifecycle, timeout precedence,
deterministic reduction, successor-fork construction, challenge handling, and resumption of normal
execution.

## System contract

- **Owned state.** Off-chain: the dispute pipeline's audit state and preserved evidence. On-chain
  (stored by enforcement, semantically owned here): the slash set, per-fork dispute windows and their
  commitments, and reduced results.
- **Public inputs.** Signed dispute claims with state proofs and auditing data; fraud proofs from the
  confirmation/validation pipelines; dispute events observed from the chain; timeout, self-removal,
  and forced-inclusion claims.
- **Public outputs.** Exactly one canonical successor fork per initiated dispute window; slash-set
  updates; dispute fraud proofs that kill invalid committed disputes; the reduced snapshot data that
  settlement adopts; resumption of off-chain execution from the successor fork's genesis.
- **Calls.** Enforcement (upload, kill, reduce, challenge, snapshot advancement); protocol model
  (finality and encoding rules for proof verification, chain-time windows); block progression (replay
  during audit re-uses the same deterministic validation); settlement (reduction output commits
  stream tips and emits exits).
- **Called by.** Block progression (escalation on validation failure or missed slots); settlement
  (forced inbound inclusion); any dispute-eligible participant or watchtower.
- **Trust and availability assumptions.** Chain liveness and at least one honest, chain-connected
  participant or watchtower per partition; required calldata, signed history, and encodings remain
  available during the evidence window; deterministic replay matches ordinary validation.
- **Ordering and concurrency.** Reduction is deterministic over the committed dispute set and must be
  order-independent ([`INV-DIS-5-J1QZ92`](disputes.md#inv-dis-5-j1qz92), with its open divergences); multiple observers may audit the same
  dispute concurrently and must reach the same result ([`INV-DISPUTE-PIPE-1-BN0K81`](dispute-processing.md#inv-dispute-pipe-1-bn0k81)).
- **Invariants (owned).** `REQ-DIS-*`, `INV-DIS-*` ([disputes.md](./disputes.md)); `REQ-FP-*`,
  `INV-FP-*` ([fraud-proofs.md](./fraud-proofs.md)); `REQ-SP-*`, `INV-SP-*`
  ([state-proofs.md](./state-proofs.md)); [`INV-DISPUTE-PIPE-1-BN0K81`](dispute-processing.md#inv-dispute-pipe-1-bn0k81), `REQ-DISPUTE-PIPE-*`
  ([dispute-processing.md](./dispute-processing.md)).
- **Failure and recovery outcomes.** Invalid committed disputes are killed and their disputers
  slashed; an aborted or failed audit fails closed without destroying evidence another honest
  participant needs; every initiated window still ends in a canonical successor fork ([`REQ-DIS-6-Y92H1M`](disputes.md#req-dis-6-y92h1m)).
- **Resource bounds.** Evidence, proof, and reduction inputs are bounded by gas/calldata limits;
  upload throttles bound spam per identity ([`REQ-DIS-2-PKVZ7E`](disputes.md#req-dis-2-pkvz7e)).
- **Verification evidence.** Requirement matrices in the owned documents; the enforcement edge is
  proven under [`REQ-IX-5-6XHJJB`](../interactions.md#req-ix-5-6xhjjb) and the proof-material edge under
  <a id="req-ix-4-bb35gc"></a>`REQ-IX-4-BB35GC`.

## Owned documents

| Document | Defines |
| --- | --- |
| [fraud-proofs.md](./fraud-proofs.md) | The immediate objective-violation path, proof categories, and the on-chain slash set it feeds. |
| [disputes.md](./disputes.md) | The dispute game: valid inputs, window lifecycle, reduction rules, timeout precedence, successor forks, anti-griefing. |
| [state-proofs.md](./state-proofs.md) | Finality anchors, milestone hops across membership changes, genesis anchoring, the permitted non-final suffix. |
| [dispute-processing.md](./dispute-processing.md) | The off-chain audit pipeline: intake binding, ordered verification, deterministic reduction, atomic recovery. |

## Interaction contracts

Consumer of proof material from block progression ([`REQ-IX-4-BB35GC`](README.md#req-ix-4-bb35gc));
producer of the adjudication edge into enforcement ([`REQ-IX-5-6XHJJB`](../interactions.md#req-ix-5-6xhjjb)) and of
reduced successor forks consumed by settlement ([`REQ-IX-6-A4Y7KB`](../interactions.md#req-ix-6-a4y7kb)).
