# Contract Composition and Adjudication Architecture

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

The on-chain protocol is one logical channel manager even when its behavior is split among separately
deployed modules. Callers must observe one stable address, one coherent storage state, one authorization
model, and one set of lifecycle, proof, dispute, and settlement semantics. Internal modularity must not
change externally observable behavior or permit a module to bypass shared validation.

## Requirements and invariants

<a id="inv-contract-arch-1"></a>
**INV-CONTRACT-ARCH-1 — Single logical state.** Every module acting for one channel manager MUST read and
write the same canonical state layout. Module selection, replacement, and internal calls MUST NOT create a
second authority or reinterpret existing state.

<a id="req-contract-arch-1"></a>
**REQ-CONTRACT-ARCH-1 — Stable external boundary.** Public lifecycle, message, proof, dispute, and view
operations MUST remain available through one stable manager boundary regardless of internal decomposition.

<a id="req-contract-arch-2"></a>
**REQ-CONTRACT-ARCH-2 — Shared validation.** Authentication, channel/fork binding, replay protection,
timing, commitment, and authorization checks that apply to more than one operation MUST have identical
semantics on every path.

<a id="req-contract-arch-3"></a>
**REQ-CONTRACT-ARCH-3 — Internal-call confinement.** Operations intended only for composition inside the
manager MUST reject direct external invocation and MUST execute with the same storage and caller context as
the initiating public operation.

<a id="req-contract-arch-4"></a>
**REQ-CONTRACT-ARCH-4 — Upgrade and deployment integrity.** A deployed composition MUST identify all
required modules, reject missing or incompatible modules, remain within platform deployment limits, and
never silently change the semantics or encoding of an existing channel.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                                       |
| ----------------------- | ------------------------------------------------------------------------------- |
| `INV-CONTRACT-ARCH-1`   | Single logical state. Every module acting for one channel manager MUST read and |
| `REQ-CONTRACT-ARCH-1`   | Stable external boundary. Public lifecycle, message, proof, dispute, and view   |
| `REQ-CONTRACT-ARCH-2`   | Shared validation. Authentication, channel/fork binding, replay protection,     |
| `REQ-CONTRACT-ARCH-3`   | Internal-call confinement. Operations intended only for composition inside the  |
| `REQ-CONTRACT-ARCH-4`   | Upgrade and deployment integrity. A deployed composition MUST identify all      |

## Assumptions and constraints

- The execution platform provides deterministic call/delegation semantics and collision-resistant selectors.
- Storage layout, selector ownership, and module versions are deployment commitments.
- Deployment size and gas limits may constrain decomposition but do not weaken protocol validation.
- A channel opened under one state-machine or storage encoding cannot be reinterpreted by a later module set.

## Security considerations

The composition boundary protects escrowed funds, authoritative channel state, module authorization, and
proof semantics. Threats include selector collision, storage collision, direct invocation of internal
operations, partial deployment, inconsistent duplicate validators, malicious replacement, and reentrancy
across modules. Every public path must fail atomically, and internal decomposition must not enlarge the
trusted caller set.

## Verification and test plan

### Requirement test matrix

| Plan item                                                   | Requirements / invariants | Setup and stimulus                                                                                                            | Expected result                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-contract-arch-1-t1"></a>`INV-CONTRACT-ARCH-1.T1` | `INV-CONTRACT-ARCH-1`     | Execute state-changing operations through every owning module and inspect the resulting manager state.                        | All paths observe one state and preserve unrelated fields.                              | <a id="inv-contract-arch-1-t1-p1"></a>`INV-CONTRACT-ARCH-1.T1.P1` — each module; <a id="inv-contract-arch-1-t1-p2"></a>`INV-CONTRACT-ARCH-1.T1.P2` — success/revert; <a id="inv-contract-arch-1-t1-p3"></a>`INV-CONTRACT-ARCH-1.T1.P3` — sequential/interleaved calls; <a id="inv-contract-arch-1-t1-p4"></a>`INV-CONTRACT-ARCH-1.T1.P4` — incompatible layout/module. |
| <a id="req-contract-arch-1-t1"></a>`REQ-CONTRACT-ARCH-1.T1` | `REQ-CONTRACT-ARCH-1`     | Invoke every public operation through the stable manager boundary.                                                            | Routing preserves the specified input, output, event, revert, and atomicity contract.   | <a id="req-contract-arch-1-t1-p1"></a>`REQ-CONTRACT-ARCH-1.T1.P1` — lifecycle; <a id="req-contract-arch-1-t1-p2"></a>`REQ-CONTRACT-ARCH-1.T1.P2` — messages/proofs; <a id="req-contract-arch-1-t1-p3"></a>`REQ-CONTRACT-ARCH-1.T1.P3` — disputes/fraud; <a id="req-contract-arch-1-t1-p4"></a>`REQ-CONTRACT-ARCH-1.T1.P4` — views and failure.                         |
| <a id="req-contract-arch-2-t1"></a>`REQ-CONTRACT-ARCH-2.T1` | `REQ-CONTRACT-ARCH-2`     | Present the same valid and invalid artifact through every path that consumes it.                                              | Every path gives the same classification and forbidden effects remain absent.           | <a id="req-contract-arch-2-t1-p1"></a>`REQ-CONTRACT-ARCH-2.T1.P1` — signatures; <a id="req-contract-arch-2-t1-p2"></a>`REQ-CONTRACT-ARCH-2.T1.P2` — channel/fork; <a id="req-contract-arch-2-t1-p3"></a>`REQ-CONTRACT-ARCH-2.T1.P3` — timing/replay; <a id="req-contract-arch-2-t1-p4"></a>`REQ-CONTRACT-ARCH-2.T1.P4` — commitments.                                  |
| <a id="req-contract-arch-3-t1"></a>`REQ-CONTRACT-ARCH-3.T1` | `REQ-CONTRACT-ARCH-3`     | Call each internal-only operation through its valid composition path and directly as an external actor.                       | Valid internal calls work; every direct call rejects without state change.              | <a id="req-contract-arch-3-t1-p1"></a>`REQ-CONTRACT-ARCH-3.T1.P1` — valid internal caller; <a id="req-contract-arch-3-t1-p2"></a>`REQ-CONTRACT-ARCH-3.T1.P2` — arbitrary caller; <a id="req-contract-arch-3-t1-p3"></a>`REQ-CONTRACT-ARCH-3.T1.P3` — reentrant callback.                                                                                               |
| <a id="req-contract-arch-4-t1"></a>`REQ-CONTRACT-ARCH-4.T1` | `REQ-CONTRACT-ARCH-4`     | Deploy complete, incomplete, duplicate, oversized, and incompatible compositions; attempt replacement after channel creation. | Only complete compatible deployments succeed; existing channels retain their semantics. | <a id="req-contract-arch-4-t1-p1"></a>`REQ-CONTRACT-ARCH-4.T1.P1` — complete; <a id="req-contract-arch-4-t1-p2"></a>`REQ-CONTRACT-ARCH-4.T1.P2` — missing/duplicate selector; <a id="req-contract-arch-4-t1-p3"></a>`REQ-CONTRACT-ARCH-4.T1.P3` — size/gas boundary; <a id="req-contract-arch-4-t1-p4"></a>`REQ-CONTRACT-ARCH-4.T1.P4` — incompatible replacement.     |

## Future Work

_Non-normative._ Define a version-negotiated migration protocol if existing channels must ever move between
compatible module compositions.
