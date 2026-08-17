# Block-Confirmation Gossip

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The gossip service carrying block confirmations between peers — the sole peer entry
> into the block-progression pipeline. Shared communication rules: [rpc.md](./rpc.md). Everything
> downstream of intake: [block-processing.md](../block-progression/block-processing.md).

## Contents

- [Purpose and observable contract](#purpose-and-observable-contract)
- [Algorithm](#algorithm)
- [System interactions](#system-interactions)
- [Failure outcomes](#failure-outcomes)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable contract

Block confirmations (a signed block plus its collected confirmation signatures) spread by gossip:
every node that authors, counter-signs, or learns new signatures re-broadcasts the grown
confirmation to every open session, fire-and-forget. This service is the receiving end — a
deliberately thin attribution shim: **the communication layer owns caller admission, sender
attribution, and the verdict-to-consequence mapping; the pipeline owns every judgment about the
bytes.** The service performs no protocol validation of the payload.

## Algorithm

**Sending.** After a confirmation-changing event (authoring, counter-signing, signature merge
growth), broadcast the updated confirmation to all open sessions. No delivery receipt is expected;
gossip redundancy plus the recovery paths of [`REQ-BLOCK-PIPE-4-CF52J6`](../block-progression/block-processing.md#req-block-pipe-4-cf52j6) provide eventual delivery.

**Receiving.**

1. The frame passes ingress dispatch and the authenticated-session gate ([rpc.md](./rpc.md)).
2. The sender's proven identity is attached to the confirmation as source attribution — the
   attribution that intake preserves per [`REQ-BLOCK-PIPE-1-SS24D1`](../block-progression/block-processing.md#req-block-pipe-1-ss24d1) and the queue stores per
   [`REQ-QSTORE-1-PS769J`](../storage/queue.md#req-qstore-1-ps769j).
3. The attributed confirmation is handed to pipeline intake ([`REQ-IX-1-WTJ0D1`](../interactions.md#req-ix-1-wtj0d1)).
   Intake is the merge regime: unordered, duplicable, mutex-free ([`REQ-BLOCK-PIPE-5-WJ31RG`](../block-progression/block-processing.md#req-block-pipe-5-wj31rg)).
4. The pipeline's verdict maps back to a communication-layer consequence: acceptable knowledge
   (new, duplicate, mergeable, not-yet-eligible) has none; an objective protocol violation
   attributable to the sender terminates and excludes the sender; non-attributable junk is dropped
   with at most session-level consequences.

## System interactions

| System                                                        | Interaction                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [Block progression](../block-progression/block-processing.md) | Sole peer input path; owns all validation, merging, ordering, and execution.                                              |
| [Storage](../storage/queue.md)                                | Attribution and merged signatures persist through the queue's copy-scoped rules.                                          |
| [Disputes](../disputes/fraud-proofs.md)                       | Attributable violations discovered downstream become fraud-proof evidence; the gossip layer only preserved who sent what. |
| [Dispute acknowledgement](./dispute-acknowledgment.md)        | A recorded acknowledger later gossiping on the dead fork loses honest-straggler tolerance.                                |

## Failure outcomes

| Failure                                                        | Outcome                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Unauthenticated or malformed frame                             | Ingress dispatch consequences ([rpc.md](./rpc.md)); never reaches intake. |
| Duplicate/older/future confirmation                            | No penalty — merged or held by the pipeline's rules.                      |
| Sender-attributable objective violation (per pipeline verdict) | Terminate and exclude the sender.                                         |
| Non-attributable invalid data                                  | Drop; session-level consequence at most.                                  |

## Requirements and invariants

**<a id="req-gossip-1-htk3nx"></a>`REQ-GOSSIP-1-HTK3NX` — Thin attributed ingress.** The gossip service MUST attach the authenticated
sender identity to every received confirmation and hand it to pipeline intake unmodified; it MUST
NOT validate, filter, reorder, or merge protocol content itself.

**<a id="req-gossip-2-9pmmnh"></a>`REQ-GOSSIP-2-9PMMNH` — Verdict-mapped consequences.** Communication-layer penalties for gossiped content
MUST follow the pipeline's verdict classification; the gossip layer never penalizes content the
pipeline classifies as acceptable knowledge, and never forgives what the pipeline attributes as the
sender's own violation.

**<a id="req-gossip-3-hqznqx"></a>`REQ-GOSSIP-3-HQZNQX` — Re-broadcast on growth.** A node MUST re-broadcast a confirmation when its local
signature set grows, so signature knowledge converges across honest peers without a request cycle.

## Assumptions and constraints

- Highest-volume ingress surface of the node; per-peer rate bounds ([`REQ-RPC-5-CV1R1Y`](rpc.md#req-rpc-5-cv1r1y),
  [`OQ-6-4JPNE5`](../open-questions.md#oq-6-4jpne5)) are the intended admission control — the pipeline's queue
  deliberately relies on this layer for frequency bounding.
- Fire-and-forget delivery: loss is recovered by gossip redundancy and pipeline sync, not by this
  service.
- Full-mesh fan-out cost is bounded by the partition-size limit
  ([`REQ-TRUST-5-NDVRW8`](../security/trust-model.md#req-trust-5-ndvrw8)).

## Security considerations

The service's safety depends on _not_ being clever: any validation or filtering here would create a
second, weaker judgment of protocol content that an adversary could play against the pipeline's
([`REQ-GOSSIP-1-HTK3NX`](block-gossip.md#req-gossip-1-htk3nx) prevents divergence). Attribution fidelity is the security payload — it converts
flooding and forgery into attributable evidence downstream. Flooding is the main residual until
rate limiting lands; structural caps in the queue bound per-entry damage.

## Verification and test plan

### Requirement test matrix

| Plan item                                                   | Requirements / invariants                                    | Setup and stimulus                                                                                 | Expected result                                                                                                        | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-gossip-1-htk3nx.t1"></a>`REQ-GOSSIP-1-HTK3NX.T1` | [`REQ-GOSSIP-1-HTK3NX`](block-gossip.md#req-gossip-1-htk3nx) | Gossip valid, duplicate, malformed, and violating confirmations from distinct authenticated peers. | Intake receives each payload byte-identical with the correct sender identity; nothing is judged at the gossip layer.   | <a id="req-gossip-1-htk3nx.t1.p1"></a>`REQ-GOSSIP-1-HTK3NX.T1.P1` — payload fidelity; <a id="req-gossip-1-htk3nx.t1.p2"></a>`REQ-GOSSIP-1-HTK3NX.T1.P2` — attribution correctness across senders of one block; <a id="req-gossip-1-htk3nx.t1.p3"></a>`REQ-GOSSIP-1-HTK3NX.T1.P3` — no gossip-layer filtering of pipeline-bound content.                                                                                                                                                                                                                                                                                                                                                                         |
| <a id="req-gossip-2-9pmmnh.t1"></a>`REQ-GOSSIP-2-9PMMNH.T1` | [`REQ-GOSSIP-2-9PMMNH`](block-gossip.md#req-gossip-2-9pmmnh) | Drive each pipeline verdict class from a gossiped frame.                                           | Acceptable knowledge carries no penalty; attributable violations exclude the sender; non-attributable junk only drops. | <a id="req-gossip-2-9pmmnh.t1.p1"></a>`REQ-GOSSIP-2-9PMMNH.T1.P1` — new-knowledge verdict unpenalized; <a id="req-gossip-2-9pmmnh.t1.p2"></a>`REQ-GOSSIP-2-9PMMNH.T1.P2` — duplicate unpenalized; <a id="req-gossip-2-9pmmnh.t1.p3"></a>`REQ-GOSSIP-2-9PMMNH.T1.P3` — same content, different verdict by context; <a id="req-gossip-2-9pmmnh.t1.p4"></a>`REQ-GOSSIP-2-9PMMNH.T1.P4` — attributable violation excludes sender; <a id="req-gossip-2-9pmmnh.t1.p5"></a>`REQ-GOSSIP-2-9PMMNH.T1.P5` — non-attributable junk dropped; <a id="req-gossip-2-9pmmnh.t1.p6"></a>`REQ-GOSSIP-2-9PMMNH.T1.P6` — older unpenalized; <a id="req-gossip-2-9pmmnh.t1.p7"></a>`REQ-GOSSIP-2-9PMMNH.T1.P7` — future unpenalized. |
| <a id="req-gossip-3-hqznqx.t1"></a>`REQ-GOSSIP-3-HQZNQX.T1` | [`REQ-GOSSIP-3-HQZNQX`](block-gossip.md#req-gossip-3-hqznqx) | Grow a stored confirmation's signature set by merge and observe outbound traffic across sessions.  | Growth triggers re-broadcast to all open sessions; no growth, no re-broadcast.                                         | <a id="req-gossip-3-hqznqx.t1.p1"></a>`REQ-GOSSIP-3-HQZNQX.T1.P1` — growth re-broadcasts; <a id="req-gossip-3-hqznqx.t1.p2"></a>`REQ-GOSSIP-3-HQZNQX.T1.P2` — duplicate merge does not; <a id="req-gossip-3-hqznqx.t1.p3"></a>`REQ-GOSSIP-3-HQZNQX.T1.P3` — convergence across three peers with partial views.                                                                                                                                                                                                                                                                                                                                                                                                  |

## Future Work

_Non-normative._ Per-peer gossip rate limiting and priority classes ([`OQ-6-4JPNE5`](../open-questions.md#oq-6-4jpne5));
delta gossip (signatures only) to cut redundant block-body traffic.
