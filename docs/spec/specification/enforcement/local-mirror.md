# Dual Execution and the Local Mirror

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The design decision that the enforcement contracts execute in two places — on-chain as
> the authority, and in each participant's local VM as a synced mirror — and the rules that make
> that safe: single implementation, equivalence constraints, unconditional sync, and
> cache-never-authority with RPC fallback, and local-first evaluation that confirms adverse answers
> on-chain.

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

The mirror is intentionally scoped to the selected channel. It runs stateful and stateless manager
logic on the participant's own hardware and observes events indexed by that channel. It does not
replicate or answer global manager state such as the enumerable set of all open channels. Unobserved
global state is neither needed for channel-local checks nor inferable from the selected channel's
event stream.

The mirror is never the authority. It answers "what would the chain say, given what I have
observed"; the chain answers "what is". Event observation has no completeness or verification
guarantee, so consequential decisions keep the specified chain/RPC fallback.

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
  event and state read ([`REQ-IX-7-A004VZ` (Chain observation)](../interactions.md#req-ix-7-a004vz)), unconditionally — the mirror
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
- **Local-first, adverse answer confirmed.** A predicate that decides an on-chain action (a
  dispute-audit predicate, the auditing-data omission) runs on the mirror first. An answer that is
  safe to act on even when the mirror lags — it leads to no on-chain action, or to an action that
  is admissible whatever the chain would answer — is acted on without asking the chain. An answer
  that would make the node act against another participant or omit data whose absence is
  slashable is re-evaluated by the chain, and the chain's answer is the one acted on. The chain is
  asked only to confirm an adverse answer: a local revert, a local execution or worker failure, and
  any other internal failure are errors that propagate, with no chain fallback and no retry. A pure predicate reads no replicated state, so it cannot lag and its
  local answer is acted on directly ([`REQ-MIRROR-4-H9C4YS`](local-mirror.md#req-mirror-4-h9c4ys)). The dispute block-structure predicate
  is such a pure predicate: it checks only the blocks of the last milestone it is given. State-proof
  verification follows the three-tier order of
  [`REQ-SP-9-7MWKY8`](../disputes/state-proofs.md#req-sp-9-7mwky8): a valid local walk is acted on,
  and only the chain answers invalid. Reduction and the validation of a committed reduced
  result are not evaluated local-first: the chain computes them. The mirror has no sync guarantee,
  so a local first pass there would not lower chain reads on average (engineer decision,
  2026-09-27).
- **Monotonic snapshot.** The mirror's copy of the on-chain snapshot never goes back, whether
  an observed event or a trusted reconciliation with a chain read offers the older snapshot
  ([`REQ-MIRROR-5-YSFRKG`](local-mirror.md#req-mirror-5-ysfrkg)).
- **Global-state boundary.** Discovery reads that enumerate all open channels go directly to the
  authoritative manager view or a permissionless indexer with manager fallback. They are not
  inferred from or synchronized into the channel-local mirror.

## Requirements and invariants

**<a id="inv-mirror-1-vaf778"></a>`INV-MIRROR-1-VAF778` — Single implementation.** Every protocol predicate evaluated locally MUST be the
same contract logic that enforces it on-chain. Client-side reimplementation of an on-chain
predicate is prohibited; a client needing a predicate the contracts do not expose must add it to
the contracts, not beside them. **Signature carve-out:** signature recovery against a declared
signer is a pure cryptographic check and MAY be evaluated in client code instead, for speed and
caching, only when it applies exactly the contracts' acceptance rule: it MUST NOT accept a
signature encoding the contracts reject and MUST NOT reject one the contracts accept. The same rule
applies to every signature of one scheme (an author signature and a confirmation signature over
the same bytes are checked the same way). The carve-out does not cover decoding of a signed
envelope: decoding is not a pure signature check, and the client and the contracts MUST apply one
encoding rule, accepting and rejecting the same byte strings.

**<a id="req-mirror-1-xcy9cb"></a>`REQ-MIRROR-1-XCY9CB` — Constrained equivalence.** Under the [equivalence constraints](#equivalence-constraints)
(same logic, same replicated state, controlled context, read-only/pinned evaluation), a local
evaluation and an on-chain evaluation of the same predicate on the same inputs MUST agree. Any
predicate evaluated outside those constraints MUST NOT be treated as an on-chain-equivalent
result.

**<a id="req-mirror-2-e9f3tm"></a>`REQ-MIRROR-2-E9F3TM` — Unconditional replication.** The mirror advances only by replicating observed
on-chain events and state. Local protocol work MUST NOT write hypothetical state into the mirror,
and replication MUST be idempotent under duplicate observation (re-processing an event converges).
When channel-open events are replayed, `InboundMessagesProcessed` precedes `ChannelOpened` and the
mirror MUST preserve the finalized genesis deposit total already established by that event stream.

**<a id="req-mirror-3-thd7k8"></a>`REQ-MIRROR-3-THD7K8` — Cache, never authority.** A local read is an optimization. Absence in the mirror
means "not observed", never "absent on chain"; any decision with on-chain consequences MUST be
anchored against the RPC view before it is acted on — except a local answer that
[`REQ-MIRROR-4-H9C4YS`](local-mirror.md#req-mirror-4-h9c4ys) lets the node act on unconfirmed — and timing-sensitive
predicates MUST account for observation lag within the trust model's bounds.

**<a id="req-mirror-4-h9c4ys"></a>`REQ-MIRROR-4-H9C4YS` — Local-first evaluation, adverse answer confirmed.** A predicate that
reads replicated state and decides an on-chain action MAY be evaluated on the mirror first. The node MAY act on the local
answer without chain confirmation only when acting on it is safe even if the mirror lags: the
answer leads to no on-chain action, or to one that is admissible whatever the chain would answer
(posting auditing data that may be unneeded). A local answer that would make the node submit a
fraud proof or omit auditing data MUST be re-evaluated by the chain on the same inputs before it is acted on, and the chain's answer
decides. The chain is consulted only to confirm such an adverse answer. A local evaluation that
reverts, runs out of gas, or fails in the local execution environment, the worker connection, or
any other internal component MUST propagate as an error: it MUST NOT fall back to the chain, MUST
NOT be retried, and MUST NOT be converted into either answer. State-proof verification is a
predicate of this kind with two local tiers: the walk from the node's latest local threshold-final
point, then the walk from the mirror's walk start. A valid local walk is acted on without chain
confirmation; an invalid local walk falls through to the chain, which alone answers invalid; a
failure at any tier is an error, verification has no unavailable result, and an error leads to no
on-chain action ([`REQ-SP-9-7MWKY8`](../disputes/state-proofs.md#req-sp-9-7mwky8)). A pure predicate — one that reads only its inputs, never replicated
state — cannot lag; under [`REQ-MIRROR-1-XCY9CB`](local-mirror.md#req-mirror-1-xcy9cb) its local answer is the chain's answer and needs no
confirmation. The dispute block-structure predicate is pure: it reads only the submitted proof.
Each local evaluation MUST be granted bounded gas: at least the larger of the
dispute execution budget and twice the upfront funding a fraud-proof replay requires for the
transition's full limit, and no more than the larger of those two and a fixed minimum floor. The
replay requirement funds only the transition's limit and the machine's fixed setup; deleting the
previous transition's outbound messages and copying the transition input come on top of it, and
cost at most about one more requirement, because they undo or move what one funded run wrote.
With twice the requirement a local transition is not refused where a funded chain replay runs it,
as far as the chain's block gas limit lets such a replay be sent. The requirement is a funding
baseline, not a bound on the rest of a dispute call (proof checks, restoring the machine's state),
which an on-chain submission funds through its own estimate; a local evaluation can therefore run
out of gas where the chain would not. For a predicate with a chain answer, running out of gas
locally is a local failure: it MUST propagate as an error and MUST NOT become an answer. A local
state transition likewise: its refusal, its out-of-gas outside the transition, and an executor
failure are local failures that MUST NOT become a verdict ([`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](execution-and-consumer.md#req-enfsm-1-dkjcy2)).

**<a id="req-mirror-5-ysfrkg"></a>`REQ-MIRROR-5-YSFRKG` — Mirror snapshot never goes back.** The mirror's copy of the
on-chain snapshot MUST NOT move to an older snapshot. The rule applies to a snapshot event and to a
trusted reconciliation that installs a snapshot read from the chain; a reconciliation carries no
event position, so the event order alone cannot stop a queued older event after it. Older means a
lower height on the stored snapshot's fork, any snapshot of the fork the stored snapshot's fork was
created from (its origin fork), or an absent snapshot (zero fork ID), which a chain read of a
closed channel returns. A snapshot at the same height on the same fork is accepted, and a snapshot
on any other fork is accepted as a new fork.

## Assumptions and constraints

- Requires a local VM able to execute the contract logic with controllable time and caller
  context ([execution.md](../runtime/execution.md) — the executor may live in its own context).
- The mirror deployment may omit production-only parts with no local role (e.g. real asset
  custody behind the consumer adapter is stubbed locally); the omission set is a deployment
  commitment and MUST NOT include any predicate the client evaluates locally.
- RPC fallback inherits the trust model's honest-RPC assumption (A6); the mirror reduces query
  volume, not the trust requirement.
- Mirror state is storage-system data ([`REQ-IX-9-AV56NR` (Storage fidelity)](../interactions.md#req-ix-9-av56nr)): rebuilt from
  chain observation after loss, per [durability.md](../storage/durability.md) [`REQ-STOR-3-4RJGER` (Restart recovery without trust)](../storage/durability.md#req-stor-3-4rjger).

## Security considerations

The mirror's dangers are exactly its conveniences. Treating the cache as truth converts RPC lag
into wrong protocol decisions ([`REQ-MIRROR-3-THD7K8`](local-mirror.md#req-mirror-3-thd7k8) is the defense); letting local work write into the
mirror poisons every later local check ([`REQ-MIRROR-2-E9F3TM`](local-mirror.md#req-mirror-2-e9f3tm)); evaluating time-dependent predicates with
uncontrolled local time yields plausible-but-wrong window verdicts ([`REQ-MIRROR-1-XCY9CB`](local-mirror.md#req-mirror-1-xcy9cb)'s context
constraint); and a version-skewed mirror silently disagrees with the manager (same-logic
constraint). The signature carve-out of [`INV-MIRROR-1-VAF778`](local-mirror.md#inv-mirror-1-vaf778) reintroduces a second implementation for
signature recovery, so its only defense is exact parity: a client check that is more permissive
than the contracts (for example one that accepts a compact or re-normalized signature encoding)
lets a Byzantine author place history in local state that fails every on-chain proof check, and one
that is stricter drops blocks the chain accepts. Parity is therefore tested differentially against
the contract logic. Envelope decoding needs the same parity: if the client and the contracts
accepted or rejected different byte encodings of one block, a Byzantine participant could post an
encoding the chain accepts and peers treat differently — for example to refute an honest timeout
dispute with posted calldata the peers never accepted. Local-first evaluation ([`REQ-MIRROR-4-H9C4YS`](local-mirror.md#req-mirror-4-h9c4ys)) accepts the safe answer unconfirmed: a lagging
mirror that clears a dispute makes this one node miss a challenge, never act wrongly, and every
other honest participant audits independently — that missed challenge is the accepted residual.
Every answer that would stake the node (a fraud proof, omitted auditing data) is decided by the
chain, and reductions and reduced-result challenges are computed by the chain directly. Treating an
executor failure as a verdict would turn infrastructure faults into protocol decisions, and a
silent chain fallback would hide a broken local environment, so every local revert or failure is an
error that propagates. Local evaluation is bounded by a per-call gas budget
([`REQ-MIRROR-4-H9C4YS`](local-mirror.md#req-mirror-4-h9c4ys)): the larger of a fixed minimum floor, the dispute execution budget and
twice the replay requirement. The replay requirement covers the transition's full limit and fixed
setup only; the second requirement covers deleting previous outbound messages and copying the
input, so a local transition is not refused where a funded chain replay runs it. The rest of a
dispute call (proof checks, state restoration) is funded on chain by the submitter's estimate and
locally only by whatever the grant leaves. A local predicate evaluation can therefore run out of
gas where the chain would run it; that failure propagates as an error, so the consequence is a
failed evaluation the caller sees, never a different answer. A local state transition that is
refused or runs out of gas outside the transition is a local failure, never an invalid transition:
if it were judged, a node with a misconfigured or failing local environment would build a fraud
proof against an honest author. The node instead raises the error and restores its state; it
cannot judge that block until its environment is fixed, while the other peers judge it. The floor can
exceed a dispute transaction's budget, so a local call can do more work than one dispute
transaction may. The accepted residual is that floor: when the chain's budgets are smaller than it,
a Byzantine dispute can make an auditor spend up to the floor in local work per evaluated predicate
before the chain is asked, which is more than the chain itself would execute for that call but
bounded and independent of the attacker. The monotonic-snapshot rule ([`REQ-MIRROR-5-YSFRKG`](local-mirror.md#req-mirror-5-ysfrkg)) recognizes
only one fork step back: a snapshot of a fork two or more reductions back is not related to the
stored fork by its origin and is accepted as a new fork, and the snapshot write made when a channel
opens is not a snapshot update under that rule. Both remain residual: a late event or a lagging chain read
of that kind can still move the copy back until a newer snapshot replaces it. A dishonest RPC can poison the mirror and the fallback alike — that is the trust
model's residual (A6), not a new exposure created here. The single-implementation rule also
concentrates risk: a contract bug is now a bug in both the enforcement and every local check, which
is the accepted trade for eliminating divergence bugs.

## Verification and test plan

### Requirement test matrix

| Plan item                                                   | Requirements / invariants                                    | Setup and stimulus                                                                                                                                                                                                                                                                                                                            | Expected result                                                                                                                                                                                                                                                                                                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-mirror-1-vaf778.t1"></a>`INV-MIRROR-1-VAF778.T1` | [`INV-MIRROR-1-VAF778`](local-mirror.md#inv-mirror-1-vaf778) | Enumerate every protocol predicate the client evaluates and locate its implementation; for the signature carve-out, feed the client check and the contract logic the same accepted and rejected encodings.                                                                                                                                    | Each locally evaluated predicate resolves to the mirrored contract logic; the only client-side check is the signature carve-out, and it accepts exactly the signature encodings the contract logic accepts.                                                                                                                                    | <a id="inv-mirror-1-vaf778.t1.p1"></a>`INV-MIRROR-1-VAF778.T1.P1` — state-proof verification maps to contract logic; <a id="inv-mirror-1-vaf778.t1.p2"></a>`INV-MIRROR-1-VAF778.T1.P2` — a needed-but-unexposed predicate is added to the contracts, not beside them; <a id="inv-mirror-1-vaf778.t1.p3"></a>`INV-MIRROR-1-VAF778.T1.P3` — dispute reduction maps to contract logic; <a id="inv-mirror-1-vaf778.t1.p4"></a>`INV-MIRROR-1-VAF778.T1.P4` — output-state construction maps to contract logic; <a id="inv-mirror-1-vaf778.t1.p5"></a>`INV-MIRROR-1-VAF778.T1.P5` — balance-invariant check maps to contract logic; <a id="inv-mirror-1-vaf778.t1.p6"></a>`INV-MIRROR-1-VAF778.T1.P6` — replay execution maps to contract logic; <a id="inv-mirror-1-vaf778.t1.p7"></a>`INV-MIRROR-1-VAF778.T1.P7` — the client signature check accepts exactly the signature encodings the contract logic accepts (ordinary, compact 64-byte, `v` outside the accepted pair, wrong length, high `s`, `r`/`s` out of range) and recovers the same signer; <a id="inv-mirror-1-vaf778.t1.p9"></a>`INV-MIRROR-1-VAF778.T1.P9` — a confirmation signature follows the same acceptance rule as the author signature over the same bytes; <a id="inv-mirror-1-vaf778.t1.p10"></a>`INV-MIRROR-1-VAF778.T1.P10` — a peer that sends a block whose author signature uses an encoding the contracts reject gets the authenticity-failure outcome, and the block is neither committed nor countersigned.                                                                                                                                                                                                                                                                                                                                                                         |
| <a id="req-mirror-1-xcy9cb.t1"></a>`REQ-MIRROR-1-XCY9CB.T1` | [`REQ-MIRROR-1-XCY9CB`](local-mirror.md#req-mirror-1-xcy9cb) | Evaluate every locally used predicate (proof verification, reduction, output construction, balance invariant, replay) locally and on-chain with identical state/inputs, then violate each equivalence constraint individually.                                                                                                                | Agreement under the constraints for every predicate; each constraint violation produces a detectably non-equivalent evaluation, never a silently trusted one.                                                                                                                                                                                  | <a id="req-mirror-1-xcy9cb.t1.p1"></a>`REQ-MIRROR-1-XCY9CB.T1.P1` — proof verification agrees; <a id="req-mirror-1-xcy9cb.t1.p2"></a>`REQ-MIRROR-1-XCY9CB.T1.P2` — uncontrolled time diverges on window predicates; <a id="req-mirror-1-xcy9cb.t1.p3"></a>`REQ-MIRROR-1-XCY9CB.T1.P3` — missing replicated state; <a id="req-mirror-1-xcy9cb.t1.p4"></a>`REQ-MIRROR-1-XCY9CB.T1.P4` — version-skewed logic detected; <a id="req-mirror-1-xcy9cb.t1.p5"></a>`REQ-MIRROR-1-XCY9CB.T1.P5` — reduction agrees; <a id="req-mirror-1-xcy9cb.t1.p6"></a>`REQ-MIRROR-1-XCY9CB.T1.P6` — output construction agrees; <a id="req-mirror-1-xcy9cb.t1.p7"></a>`REQ-MIRROR-1-XCY9CB.T1.P7` — balance invariant agrees; <a id="req-mirror-1-xcy9cb.t1.p8"></a>`REQ-MIRROR-1-XCY9CB.T1.P8` — replay agrees.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| <a id="req-mirror-2-e9f3tm.t1"></a>`REQ-MIRROR-2-E9F3TM.T1` | [`REQ-MIRROR-2-E9F3TM`](local-mirror.md#req-mirror-2-e9f3tm) | Replay event streams with duplicates, reordering, and gaps; attempt local hypothetical writes.                                                                                                                                                                                                                                                | Replication converges idempotently; gaps leave explicit absence; no non-replication write path exists into mirror state.                                                                                                                                                                                                                       | <a id="req-mirror-2-e9f3tm.t1.p1"></a>`REQ-MIRROR-2-E9F3TM.T1.P1` — duplicate/reordered events converge; <a id="req-mirror-2-e9f3tm.t1.p2"></a>`REQ-MIRROR-2-E9F3TM.T1.P2` — gap leaves absence, later fill converges; <a id="req-mirror-2-e9f3tm.t1.p3"></a>`REQ-MIRROR-2-E9F3TM.T1.P3` — local work cannot mutate mirror state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| <a id="req-mirror-3-thd7k8.t1"></a>`REQ-MIRROR-3-THD7K8.T1` | [`REQ-MIRROR-3-THD7K8`](local-mirror.md#req-mirror-3-thd7k8) | Serve reads with the mirror fresh, lagging, and missing records, for informational and consequential decisions.                                                                                                                                                                                                                               | Fresh-mirror reads short-circuit; consequential decisions on lagging/missing data anchor to the RPC view; absence never resolves to "does not exist".                                                                                                                                                                                          | <a id="req-mirror-3-thd7k8.t1.p1"></a>`REQ-MIRROR-3-THD7K8.T1.P1` — fresh cache hit; <a id="req-mirror-3-thd7k8.t1.p2"></a>`REQ-MIRROR-3-THD7K8.T1.P2` — lagging mirror, chain fallback decides; <a id="req-mirror-3-thd7k8.t1.p3"></a>`REQ-MIRROR-3-THD7K8.T1.P3` — missing record treated as unobserved; <a id="req-mirror-3-thd7k8.t1.p4"></a>`REQ-MIRROR-3-THD7K8.T1.P4` — timing predicate near a window edge under observation lag.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| <a id="req-mirror-4-h9c4ys.t1"></a>`REQ-MIRROR-4-H9C4YS.T1` | [`REQ-MIRROR-4-H9C4YS`](local-mirror.md#req-mirror-4-h9c4ys) | For each decision the node takes local-first (dispute-audit predicates, the auditing-data omission), force the mirror to agree with the chain, to disagree in each direction, to revert, to run out of gas, and to fail outside the mirrored logic; run a local evaluation that needs more gas than the fixed floor.                          | A safe local answer is acted on with no chain evaluation; an adverse local answer is acted on only after the chain evaluates the same inputs, and the chain answer wins on disagreement; a revert, an out-of-gas, and an executor or worker failure surface as an error with no chain evaluation, no retry, no verdict and no on-chain action. | <a id="req-mirror-4-h9c4ys.t1.p1"></a>`REQ-MIRROR-4-H9C4YS.T1.P1` — a safe local answer is acted on without a chain evaluation; <a id="req-mirror-4-h9c4ys.t1.p2"></a>`REQ-MIRROR-4-H9C4YS.T1.P2` — an adverse local audit answer is confirmed by the chain before a fraud proof is stored; <a id="req-mirror-4-h9c4ys.t1.p3"></a>`REQ-MIRROR-4-H9C4YS.T1.P3` — a lagging mirror reports a dispute invalid, the chain reports it valid: no fraud proof; <a id="req-mirror-4-h9c4ys.t1.p4"></a>`REQ-MIRROR-4-H9C4YS.T1.P4` — auditing data is omitted only on a chain-confirmed finality answer; <a id="req-mirror-4-h9c4ys.t1.p8"></a>`REQ-MIRROR-4-H9C4YS.T1.P8` — a local executor or worker failure propagates as an error with no verdict, no chain evaluation and no retry; <a id="req-mirror-4-h9c4ys.t1.p10"></a>`REQ-MIRROR-4-H9C4YS.T1.P10` — a local evaluation that needs more than the fixed floor but no more than the chain's budget completes locally when funded with the chain's budget; <a id="req-mirror-4-h9c4ys.t1.p11"></a>`REQ-MIRROR-4-H9C4YS.T1.P11` — the same evaluation funded with only the floor fails for gas; <a id="req-mirror-4-h9c4ys.t1.p12"></a>`REQ-MIRROR-4-H9C4YS.T1.P12` — a pure predicate's adverse local answer is acted on without a chain evaluation; <a id="req-mirror-4-h9c4ys.t1.p13"></a>`REQ-MIRROR-4-H9C4YS.T1.P13` — a pure predicate's clearing local answer is acted on without a chain evaluation; <a id="req-mirror-4-h9c4ys.t1.p15"></a>`REQ-MIRROR-4-H9C4YS.T1.P15` — the input-only block-structure predicate's adverse answer on the last milestone is acted on without a chain read or a snapshot reconciliation; <a id="req-mirror-4-h9c4ys.t1.p16"></a>`REQ-MIRROR-4-H9C4YS.T1.P16` — the mirrored logic reverts locally: the error propagates with no chain evaluation, no retry and no verdict |
| <a id="req-mirror-5-ysfrkg.t1"></a>`REQ-MIRROR-5-YSFRKG.T1` | [`REQ-MIRROR-5-YSFRKG`](local-mirror.md#req-mirror-5-ysfrkg) | On a local deployment, store a snapshot, then offer newer and older snapshots of the same fork, a snapshot of a new fork, a later snapshot of that new fork's origin fork, and an absent (zero-fork) snapshot, each as an observed event and as a trusted reconciliation without an event position; read the stored snapshot after each step. | The stored snapshot never moves to a lower height on its fork, to its origin fork, or to an absent snapshot; an equal height and a new fork are accepted.                                                                                                                                                                                      | <a id="req-mirror-5-ysfrkg.t1.p1"></a>`REQ-MIRROR-5-YSFRKG.T1.P1` — an older same-fork snapshot event that arrives after a newer reconciled snapshot is refused; <a id="req-mirror-5-ysfrkg.t1.p2"></a>`REQ-MIRROR-5-YSFRKG.T1.P2` — a reconciliation with an older same-fork snapshot read from the chain is refused and the mirror keeps its copy; <a id="req-mirror-5-ysfrkg.t1.p3"></a>`REQ-MIRROR-5-YSFRKG.T1.P3` — a different same-fork snapshot at the stored height is accepted; <a id="req-mirror-5-ysfrkg.t1.p4"></a>`REQ-MIRROR-5-YSFRKG.T1.P4` — a reconciled snapshot of a new fork replaces the stored snapshot of its origin fork; <a id="req-mirror-5-ysfrkg.t1.p5"></a>`REQ-MIRROR-5-YSFRKG.T1.P5` — after a new fork's snapshot, a later snapshot event of its origin fork is refused; <a id="req-mirror-5-ysfrkg.t1.p6"></a>`REQ-MIRROR-5-YSFRKG.T1.P6` — a reconciliation with an absent (zero-fork) snapshot is refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Genesis-deposit regression matrix

| Plan item                                                   | Requirements / invariants                                    | Setup and stimulus                                                                                            | Expected result                                                          | Required permutations                                                                                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-mirror-1-xcy9cb.t2"></a>`REQ-MIRROR-1-XCY9CB.T2` | [`REQ-MIRROR-1-XCY9CB`](local-mirror.md#req-mirror-1-xcy9cb) | Audit disputes after opening a channel with nonzero genesis deposits, then alter the committed deposit total. | Honest replay passes the balance invariant; altered deposits fail it.    | <a id="req-mirror-1-xcy9cb.t2.p1"></a>`REQ-MIRROR-1-XCY9CB.T2.P1` — honest nonzero genesis deposits pass; <a id="req-mirror-1-xcy9cb.t2.p2"></a>`REQ-MIRROR-1-XCY9CB.T2.P2` — altered nonzero genesis deposits fail. |
| <a id="req-mirror-2-e9f3tm.t2"></a>`REQ-MIRROR-2-E9F3TM.T2` | [`REQ-MIRROR-2-E9F3TM`](local-mirror.md#req-mirror-2-e9f3tm) | Replay `InboundMessagesProcessed` followed by `ChannelOpened` for a channel with nonzero genesis deposits.    | The finalized genesis deposit total remains in the local balance mirror. | <a id="req-mirror-2-e9f3tm.t2.p1"></a>`REQ-MIRROR-2-E9F3TM.T2.P1` — channel-open replay preserves finalized genesis deposits.                                                                                        |

## Future Work

_Non-normative._ A verified light-client RPC can expose a complete verified manager state and let
the same normal manager operations execute locally. That direction replaces the temporary event-fed
mirror rather than expanding it into global-state synchronization. Mirror snapshot/restore may also
avoid full re-replication after restart once disk persistence lands.
