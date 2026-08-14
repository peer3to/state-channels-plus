# Dual Execution and the Local Mirror

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The design decision that the enforcement contracts execute in two places — on-chain as
> the authority, and in each participant's local VM as a synced mirror — and the rules that make
> that safe: single implementation, equivalence constraints, unconditional sync, and
> cache-never-authority with RPC fallback.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Equivalence constraints](#equivalence-constraints)
- [Sync and fallback](#sync-and-fallback)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

The protocol's deterministic predicates — state-proof verification, dispute reduction, output-state
construction, balance-invariant checks, replay execution — are implemented **once**, as contract
code. Each participant runs a local deployment of the same logic in its local VM and evaluates
predicates there instead of reimplementing them in client code. This cuts the bug surface in half
by construction: there is no second implementation to diverge, so _if it verifies on-chain, it
verifies locally the same way_ — within the stated constraints below, which is exactly why those
constraints must be explicit.

The local deployment serves two roles:

1. **Deterministic check engine.** Sync verification, dispute audit, fraud-proof preflight, and
   output-snapshot computation call the mirrored contract logic locally, with no gas cost and no
   round trip.
2. **Free read cache.** The mirror is continuously advanced from observed on-chain events and
   state, so ordinary reads (snapshots, windows, slash sets, calldata commitments) are served
   locally instead of hammering the RPC provider.

The mirror is never the authority. It answers "what would the chain say, given what I have
observed"; the chain answers "what is".

## Equivalence constraints

Local evaluation equals on-chain evaluation only when all of the following hold. Outside them,
local results are advisory at best:

- **Same logic.** The mirrored deployment runs the same contract logic as the live manager —
  matching protocol version and semantics. A client MUST NOT mirror one version against a manager
  running another.
- **Same state.** The predicate reads only state the mirror has faithfully replicated. A predicate
  touching state the mirror lacks (an unsynced window, a missed event) evaluates against a
  _different world_, not a stale copy of the same one — see [Sync and fallback](#sync-and-fallback).
- **Controlled context.** Predicates that read ambient chain context — above all block time for
  period arithmetic (kill, evidence, challenge windows), and any caller-identity dependence — are
  locally valid only when the local VM's context is explicitly set to the intended values. Time
  drives most enforcement predicates, so local time control is load-bearing
  ([time.md](../protocol-model/time.md)).
- **State-free or state-pinned evaluation.** Local checks run read-only or against explicitly
  supplied state (the local analogue of call simulation); a local evaluation MUST NOT mutate
  mirror state that sync later reconciles, or the mirror stops being a copy.

Predicates satisfying these constraints are the intended local workload. Anything else — and any
result that will be _acted on_ with on-chain consequences — needs chain confirmation.

## Sync and fallback

- **Unconditional sync.** The client advances the mirror from every relevant observed on-chain
  event and state read ([`REQ-IX-7-A004VZ`](../interactions.md#req-ix-7-a004vz)), unconditionally — the mirror
  tracks the chain, never a local hypothesis. Mirror writes are event-driven replication, not local
  decisions.
- **No completeness proof.** Without a light client, the node cannot prove its observed view is
  complete: an empty or missing local record means "not observed", never "does not exist on
  chain". RPC lag, missed events, and provider dishonesty are indistinguishable locally
  ([trust-model.md](../security/trust-model.md) §5).
- **Fallback rule.** Reads whose _absence or staleness changes a protocol decision_ — dispute
  eligibility, window existence and timing, calldata commitments for timeout claims, current
  snapshot before a submission — consult the mirror first and MUST fall back to the RPC view
  before the decision is acted on. The mirror optimizes the happy path; the chain decides.

## Requirements and invariants

**<a id="inv-mirror-1-vaf778"></a>`INV-MIRROR-1-VAF778` — Single implementation.** Every protocol predicate evaluated locally MUST be the
same contract logic that enforces it on-chain. Client-side reimplementation of an on-chain
predicate is prohibited; a client needing a predicate the contracts do not expose must add it to
the contracts, not beside them.

**<a id="req-mirror-1-xcy9cb"></a>`REQ-MIRROR-1-XCY9CB` — Constrained equivalence.** Under the [equivalence constraints](#equivalence-constraints)
(same logic, same replicated state, controlled context, read-only/pinned evaluation), a local
evaluation and an on-chain evaluation of the same predicate on the same inputs MUST agree. Any
predicate evaluated outside those constraints MUST NOT be treated as an on-chain-equivalent
result.

**<a id="req-mirror-2-e9f3tm"></a>`REQ-MIRROR-2-E9F3TM` — Unconditional replication.** The mirror advances only by replicating observed
on-chain events and state. Local protocol work MUST NOT write hypothetical state into the mirror,
and replication MUST be idempotent under duplicate observation (re-processing an event converges).

**<a id="req-mirror-3-thd7k8"></a>`REQ-MIRROR-3-THD7K8` — Cache, never authority.** A local read is an optimization. Absence in the mirror
means "not observed", never "absent on chain"; any decision with on-chain consequences MUST be
anchored against the RPC view before it is acted on, and timing-sensitive predicates MUST account
for observation lag within the trust model's bounds.

## Assumptions and constraints

- Requires a local VM able to execute the contract logic with controllable time and caller
  context ([execution.md](../runtime/execution.md) — the executor may live in its own context).
- The mirror deployment may omit production-only parts with no local role (e.g. real asset
  custody behind the consumer adapter is stubbed locally); the omission set is a deployment
  commitment and MUST NOT include any predicate the client evaluates locally.
- RPC fallback inherits the trust model's honest-RPC assumption (A6); the mirror reduces query
  volume, not the trust requirement.
- Mirror state is storage-system data ([`REQ-IX-9-AV56NR`](../interactions.md#req-ix-9-av56nr)): rebuilt from
  chain observation after loss, per [durability.md](../storage/durability.md) [`REQ-STOR-3-4RJGER`](../storage/durability.md#req-stor-3-4rjger).

## Security considerations

The mirror's dangers are exactly its conveniences. Treating the cache as truth converts RPC lag
into wrong protocol decisions ([`REQ-MIRROR-3-THD7K8`](local-mirror.md#req-mirror-3-thd7k8) is the defense); letting local work write into the
mirror poisons every later local check ([`REQ-MIRROR-2-E9F3TM`](local-mirror.md#req-mirror-2-e9f3tm)); evaluating time-dependent predicates with
uncontrolled local time yields plausible-but-wrong window verdicts ([`REQ-MIRROR-1-XCY9CB`](local-mirror.md#req-mirror-1-xcy9cb)'s context
constraint); and a version-skewed mirror silently disagrees with the manager (same-logic
constraint). A dishonest RPC can poison the mirror and the fallback alike — that is the trust
model's residual (A6), not a new exposure created here. The single-implementation rule also
concentrates risk: a contract bug is now a bug in both the enforcement and every local check, which
is the accepted trade for eliminating divergence bugs.

## Verification and test plan

### Requirement test matrix

| Plan item                                                   | Requirements / invariants                                    | Setup and stimulus                                                                                                                                                                                                             | Expected result                                                                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-mirror-1-vaf778.t1"></a>`INV-MIRROR-1-VAF778.T1` | [`INV-MIRROR-1-VAF778`](local-mirror.md#inv-mirror-1-vaf778) | Enumerate every protocol predicate the client evaluates and locate its implementation.                                                                                                                                         | Each locally evaluated predicate resolves to the mirrored contract logic; no client-side reimplementation of an on-chain predicate exists.                    | <a id="inv-mirror-1-vaf778.t1.p1"></a>`INV-MIRROR-1-VAF778.T1.P1` — state-proof verification maps to contract logic; <a id="inv-mirror-1-vaf778.t1.p2"></a>`INV-MIRROR-1-VAF778.T1.P2` — a needed-but-unexposed predicate is added to the contracts, not beside them; <a id="inv-mirror-1-vaf778.t1.p3"></a>`INV-MIRROR-1-VAF778.T1.P3` — dispute reduction maps to contract logic; <a id="inv-mirror-1-vaf778.t1.p4"></a>`INV-MIRROR-1-VAF778.T1.P4` — output-state construction maps to contract logic; <a id="inv-mirror-1-vaf778.t1.p5"></a>`INV-MIRROR-1-VAF778.T1.P5` — balance-invariant check maps to contract logic; <a id="inv-mirror-1-vaf778.t1.p6"></a>`INV-MIRROR-1-VAF778.T1.P6` — replay execution maps to contract logic.                                                  |
| <a id="req-mirror-1-xcy9cb.t1"></a>`REQ-MIRROR-1-XCY9CB.T1` | [`REQ-MIRROR-1-XCY9CB`](local-mirror.md#req-mirror-1-xcy9cb) | Evaluate every locally used predicate (proof verification, reduction, output construction, balance invariant, replay) locally and on-chain with identical state/inputs, then violate each equivalence constraint individually. | Agreement under the constraints for every predicate; each constraint violation produces a detectably non-equivalent evaluation, never a silently trusted one. | <a id="req-mirror-1-xcy9cb.t1.p1"></a>`REQ-MIRROR-1-XCY9CB.T1.P1` — proof verification agrees; <a id="req-mirror-1-xcy9cb.t1.p2"></a>`REQ-MIRROR-1-XCY9CB.T1.P2` — uncontrolled time diverges on window predicates; <a id="req-mirror-1-xcy9cb.t1.p3"></a>`REQ-MIRROR-1-XCY9CB.T1.P3` — missing replicated state; <a id="req-mirror-1-xcy9cb.t1.p4"></a>`REQ-MIRROR-1-XCY9CB.T1.P4` — version-skewed logic detected; <a id="req-mirror-1-xcy9cb.t1.p5"></a>`REQ-MIRROR-1-XCY9CB.T1.P5` — reduction agrees; <a id="req-mirror-1-xcy9cb.t1.p6"></a>`REQ-MIRROR-1-XCY9CB.T1.P6` — output construction agrees; <a id="req-mirror-1-xcy9cb.t1.p7"></a>`REQ-MIRROR-1-XCY9CB.T1.P7` — balance invariant agrees; <a id="req-mirror-1-xcy9cb.t1.p8"></a>`REQ-MIRROR-1-XCY9CB.T1.P8` — replay agrees. |
| <a id="req-mirror-2-e9f3tm.t1"></a>`REQ-MIRROR-2-E9F3TM.T1` | [`REQ-MIRROR-2-E9F3TM`](local-mirror.md#req-mirror-2-e9f3tm) | Replay event streams with duplicates, reordering, and gaps; attempt local hypothetical writes.                                                                                                                                 | Replication converges idempotently; gaps leave explicit absence; no non-replication write path exists into mirror state.                                      | <a id="req-mirror-2-e9f3tm.t1.p1"></a>`REQ-MIRROR-2-E9F3TM.T1.P1` — duplicate/reordered events converge; <a id="req-mirror-2-e9f3tm.t1.p2"></a>`REQ-MIRROR-2-E9F3TM.T1.P2` — gap leaves absence, later fill converges; <a id="req-mirror-2-e9f3tm.t1.p3"></a>`REQ-MIRROR-2-E9F3TM.T1.P3` — local work cannot mutate mirror state.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| <a id="req-mirror-3-thd7k8.t1"></a>`REQ-MIRROR-3-THD7K8.T1` | [`REQ-MIRROR-3-THD7K8`](local-mirror.md#req-mirror-3-thd7k8) | Serve reads with the mirror fresh, lagging, and missing records, for informational and consequential decisions.                                                                                                                | Fresh-mirror reads short-circuit; consequential decisions on lagging/missing data anchor to the RPC view; absence never resolves to "does not exist".         | <a id="req-mirror-3-thd7k8.t1.p1"></a>`REQ-MIRROR-3-THD7K8.T1.P1` — fresh cache hit; <a id="req-mirror-3-thd7k8.t1.p2"></a>`REQ-MIRROR-3-THD7K8.T1.P2` — lagging mirror, chain fallback decides; <a id="req-mirror-3-thd7k8.t1.p3"></a>`REQ-MIRROR-3-THD7K8.T1.P3` — missing record treated as unobserved; <a id="req-mirror-3-thd7k8.t1.p4"></a>`REQ-MIRROR-3-THD7K8.T1.P4` — timing predicate near a window edge under observation lag.                                                                                                                                                                                                                                                                                                                                                   |

## Future Work

_Non-normative._ A light-client or self-verifying chain view would upgrade "cannot prove
completeness" into checkable sync status and shrink the RPC trust assumption
([trust-model.md](../security/trust-model.md) future work); mirror snapshot/restore to avoid full
re-replication after restart once disk persistence lands.
