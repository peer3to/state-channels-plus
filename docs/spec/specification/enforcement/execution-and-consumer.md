# Execution and Consumer-Adapter Module

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.
> **Scope:** The enforcement module owning contract-side state-machine execution (deterministic
> replay) and the delegation boundary to the integrator's consumer adapter. Composition rules:
> [contracts.md](./contracts.md). Semantics owner:
> [state-machines.md](../protocol-model/state-machines.md).

## Contents

- [Responsibility and owned state](#responsibility-and-owned-state)
- [Execution surface](#execution-surface)
- [Consumer-adapter boundary](#consumer-adapter-boundary)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Responsibility and owned state

Owned state: the reference to the deployed state-machine implementation and the configured gas
limit for its execution. The state machine's own storage is a scratch execution area, not
protocol state — protocol truth is the _encoded_ state committed through snapshots
([`INV-HIST-1-5N44K9`](../protocol-model/history-and-commitments.md#inv-hist-1-5n44k9)).

## Execution surface

Replay execution — used by invalid-transition fraud proofs and dispute output construction —
follows the restore → execute → extract pattern:

1. **Restore.** Load the supplied encoded pre-state into the machine (`setState` semantics,
   [`REQ-SM-2-PHCRFR`](../protocol-model/state-machines.md#req-sm-2-phcrfr)).
2. **Execute.** Run the transition with the protocol-injected execution context — logical author,
   transaction data, protocol time — never ambient chain context
   ([`REQ-SM-1-Y72CKX`](../protocol-model/state-machines.md#req-sm-1-y72ckx) family](../protocol-model/state-machines.md)); bounded by the configured gas limit.
3. **Extract.** Read back the encoded post-state and produced outbound messages; the caller
   compares against claimed commitments.

Join application (admission and top-up against an encoded state) follows the same pattern through
the machine's join entry point. All of this is internal-only composition
([`REQ-CONTRACT-ARCH-3-GEGD78` (Internal-call confinement)](contracts.md#req-contract-arch-3-gegd78)): external callers cannot drive the machine directly through the manager.

**Known constraint (current behavior).** One shared state-machine deployment serves all channels:
replay execution selects the machine independently of the channel. Correctness therefore relies on
full pre-state restoration; channels with different machine _implementations_ on one manager are
unsupported. Flagged for the engineer as a deployment constraint.

## Consumer-adapter boundary

The integrator's consumer adapter owns asset custody (deposit, withdraw) and any custom
application operations surfaced through the manager. The protocol constrains it at the boundary:

- Reached only through the manager's delegation — deposits/withdrawals via the internal composition
  path ([admission-and-funds.md](./admission-and-funds.md),
  [snapshot-adoption.md](./snapshot-adoption.md)); custom operations via the manager's
  pass-through surface.
- Its verdicts are binding at the call site (a failed withdraw blocks the enclosing advance; a
  failed deposit fails the join per composition mode) — the protocol does not second-guess
  integrator custody logic, it only bounds its blast radius by atomicity rules.
- It executes in the manager's storage context; a misbehaving adapter is inside the trust boundary
  of the channel's funds and is the integrator's declared responsibility
  ([state-machines.md](../protocol-model/state-machines.md) integration contract).

## Requirements and invariants

**<a id="inv-enfsm-1-762acd"></a>`INV-ENFSM-1-762ACD` — Replay from supplied state only.** Contract-side execution restores the complete
supplied pre-state before executing and derives nothing from residual machine storage; two replays
of the same (pre-state, transition) MUST yield identical post-state and messages regardless of what
executed before.

**<a id="req-enfsm-1-dkjcy2"></a>`REQ-ENFSM-1-DKJCY2` — Injected context, bounded gas.** Execution supplies the protocol's execution
context and enforces the configured gas limit; a transition exceeding it fails as an invalid
transition, identically in fraud-proof replay and local-mirror evaluation
([`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](local-mirror.md#req-mirror-1-xcy9cb)). The gas attached to a transaction
MUST never decide whether a transition is valid: a transition MUST run only when it can be granted
the full configured limit, and a replay that cannot grant it MUST fail the enclosing call before the
transition runs, without a verdict. The funding check MUST come after all work whose cost depends
on the transaction (for example copying the transition input), so the gas the transition receives
can never fall below the limit after the check passed. A transition that runs out of gas within the
full limit is an invalid transition. The manager MUST expose the gas a fraud-proof transaction has to carry on top
of its own cost so that every replayed transition is granted the full limit through all enclosing
calls, and a fraud-proof submitter MUST fund its replay with it upfront. Local-mirror evaluation
MUST always be funded past that requirement, so it never reaches the refusal.

**<a id="req-enfsm-2-g4hbkg"></a>`REQ-ENFSM-2-G4HBKG` — Adapter confinement.** The consumer adapter is reachable only through the
manager's specified delegation points; its failures propagate exactly as the enclosing operation's
atomicity rules state, and it cannot reach protocol storage outside its call's scope.

A consumer may define a balance-funded off-chain insertion transition ([`REQ-SM-11-VVP01C` (Application-defined participant insertion)](../protocol-model/state-machines.md#req-sm-11-vvp01c)). It remains
subject to deterministic execution, participant enumeration, and balance conservation. This optional
consumer capability is not a required protocol endpoint and does not broaden chain dispute eligibility.

## Assumptions and constraints

- The integrator machine honors the deterministic-replay contract
  ([state-machines.md](../protocol-model/state-machines.md)); this module cannot repair a
  non-deterministic machine, only give it identical conditions.
- The gas limit is a deployment configuration commitment
  ([configuration.md](../runtime/configuration.md)) — changing it changes which transitions are
  valid, so it is part of what participants agreed to.
- The shared-deployment constraint above holds for this protocol version.

## Security considerations

Replay execution is where fraud proofs get their teeth: if restore-execute-extract can be
influenced by residual state, ambient context, or gas asymmetry, an attacker can make an honest
transition look fraudulent or a fraudulent one look honest — [`INV-ENFSM-1-762ACD`](execution-and-consumer.md#inv-enfsm-1-762acd)/[`REQ-ENFSM-1-DKJCY2`](execution-and-consumer.md#req-enfsm-1-dkjcy2) close
those channels. Gas is the subtle one: the fraud-proof submitter chooses the gas it attaches, and
the EVM silently hands a transition less than its limit when less remains, so an attacker could
under-fund the replay of an honest transition, make it fail, and turn that failure into a slash.
Refusing to run any transition that cannot be granted its full limit, and funding every replay
upfront by the manager's published requirement, removes that lever. The residual is cost, not
correctness: every replay transaction must carry the requirement (somewhat more than the
transition limit itself) plus its other work, so it fits a block only while that total, with the
submitter's safety margin, stays below the block gas limit; a larger replay cannot be submitted at
all and its fraud stays unproven on-chain until the configured limit is lowered. A submitter
declares its gas estimate plus the requirement. An estimator that reports the gas a run spends
counts only what the transition used, never the unused part of the limit that must be free when
the replay starts, and the work before the replay (proof checks, restoring the machine's state,
deleting the previous transition's outbound messages) varies with the dispute, so no fixed margin
replaces the addition. An estimator that searches for the smallest sufficient gas already includes
the requirement; there the sum declares more than the replay needs — with the submitter's safety
margin, at least about 2.5 times the requirement. The excess does not change a verdict, but it is
not free: the declared amount must still fit a block, so on a searching estimator the block gas
limit bounds the configured transition and dispute limits more tightly than the replay's real cost
does, and a configuration that fits under one estimator can leave fraud proofs unsubmittable under
the other. The adapter is deliberately _inside_ the funds trust boundary; the protocol's
defense is confinement (specified delegation points, scoped failures) plus the integrator contract,
not sandboxing. The known blocked-withdrawal question (a reverting adapter blocking snapshot
advance) is owned by [cross-layer-messages.md](../settlement/cross-layer-messages.md).

## Verification and test plan

### Requirement test matrix

| Plan item                                                 | Requirements / invariants                                            | Setup and stimulus                                                                                                                                                                                                                                                                                                                                                          | Expected result                                                                                                                                                                                                                                                                               | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-enfsm-1-762acd.t1"></a>`INV-ENFSM-1-762ACD.T1` | [`INV-ENFSM-1-762ACD`](execution-and-consumer.md#inv-enfsm-1-762acd) | Replay identical (pre-state, transition) pairs after unrelated executions, with dirty machine storage, and repeatedly.                                                                                                                                                                                                                                                      | Bit-identical post-state and messages every time; residual storage has no effect.                                                                                                                                                                                                             | <a id="inv-enfsm-1-762acd.t1.p1"></a>`INV-ENFSM-1-762ACD.T1.P1` — clean vs dirty prior state; <a id="inv-enfsm-1-762acd.t1.p2"></a>`INV-ENFSM-1-762ACD.T1.P2` — repeated replay stability; <a id="inv-enfsm-1-762acd.t1.p3"></a>`INV-ENFSM-1-762ACD.T1.P3` — interleaved channels on the shared deployment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| <a id="req-enfsm-1-dkjcy2.t1"></a>`REQ-ENFSM-1-DKJCY2.T1` | [`REQ-ENFSM-1-DKJCY2`](execution-and-consumer.md#req-enfsm-1-dkjcy2) | Execute transitions that read injected context, attempt ambient context, sit at the gas boundary, exceed it, and replay with less gas attached than the full limit needs, and with inputs of any size, for cheap transitions, for transitions that catch an inner out-of-gas, and for ones that run out; submit a fraud proof funded with the manager's replay requirement. | Injected values govern; gas-limit failures classify as invalid transitions identically on-chain and in the mirror; any replay that cannot grant the full limit fails the call before the transition runs, with no verdict; a replay funded with the manager's requirement is judged normally. | <a id="req-enfsm-1-dkjcy2.t1.p1"></a>`REQ-ENFSM-1-DKJCY2.T1.P1` — injected context honored; <a id="req-enfsm-1-dkjcy2.t1.p2"></a>`REQ-ENFSM-1-DKJCY2.T1.P2` — at the gas bound; <a id="req-enfsm-1-dkjcy2.t1.p3"></a>`REQ-ENFSM-1-DKJCY2.T1.P3` — on-chain vs mirror classification agreement; <a id="req-enfsm-1-dkjcy2.t1.p4"></a>`REQ-ENFSM-1-DKJCY2.T1.P4` — over the gas bound; <a id="req-enfsm-1-dkjcy2.t1.p5"></a>`REQ-ENFSM-1-DKJCY2.T1.P5` — an under-funded replay of a transition that would run out of gas is refused without a verdict; <a id="req-enfsm-1-dkjcy2.t1.p6"></a>`REQ-ENFSM-1-DKJCY2.T1.P6` — attached gas never flips an honest verdict; <a id="req-enfsm-1-dkjcy2.t1.p7"></a>`REQ-ENFSM-1-DKJCY2.T1.P7` — attached gas never flips an over-limit verdict; <a id="req-enfsm-1-dkjcy2.t1.p8"></a>`REQ-ENFSM-1-DKJCY2.T1.P8` — an under-funded replay of a cheap transition is refused before it runs, without a verdict; <a id="req-enfsm-1-dkjcy2.t1.p9"></a>`REQ-ENFSM-1-DKJCY2.T1.P9` — an under-funded replay of a transition that catches an inner out-of-gas is refused before it runs, without a verdict; <a id="req-enfsm-1-dkjcy2.t1.p11"></a>`REQ-ENFSM-1-DKJCY2.T1.P11` — a funded replay of a transition that catches an inner out-of-gas is judged on its result; <a id="req-enfsm-1-dkjcy2.t1.p10"></a>`REQ-ENFSM-1-DKJCY2.T1.P10` — a fraud proof carrying its cost plus the manager's replay requirement grants the replayed transition its full limit; <a id="req-enfsm-1-dkjcy2.t1.p12"></a>`REQ-ENFSM-1-DKJCY2.T1.P12` — a transition with a large input is either refused before it runs or granted the full limit; the input size never reduces the gas the transition receives. |
| <a id="req-enfsm-2-g4hbkg.t1"></a>`REQ-ENFSM-2-G4HBKG.T1` | [`REQ-ENFSM-2-G4HBKG`](execution-and-consumer.md#req-enfsm-2-g4hbkg) | Call adapter operations through the specified delegation and directly; fail the adapter inside each enclosing operation.                                                                                                                                                                                                                                                    | Direct external access is refused; failures propagate exactly per the enclosing atomicity rules; no out-of-scope storage effects.                                                                                                                                                             | <a id="req-enfsm-2-g4hbkg.t1.p1"></a>`REQ-ENFSM-2-G4HBKG.T1.P1` — direct access refused; <a id="req-enfsm-2-g4hbkg.t1.p2"></a>`REQ-ENFSM-2-G4HBKG.T1.P2` — failure inside deposit composition; <a id="req-enfsm-2-g4hbkg.t1.p3"></a>`REQ-ENFSM-2-G4HBKG.T1.P3` — failure inside withdrawal processing; <a id="req-enfsm-2-g4hbkg.t1.p4"></a>`REQ-ENFSM-2-G4HBKG.T1.P4` — adapter storage-scope containment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Future Work

_Non-normative._ Per-channel machine selection if multi-machine managers are ever wanted; the
stateless/transient replay design that avoids persistent storage writes
([state-machines.md](../protocol-model/state-machines.md) future work); adapter misbehavior
containment beyond confinement (e.g. bounded-gas adapter calls).
