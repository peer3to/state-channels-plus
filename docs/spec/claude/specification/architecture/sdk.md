# Participant SDK and Service Architecture

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

A participant implementation coordinates transport, RPC, block validation, state execution, agreement,
storage, chain observation, recovery, and application events behind one lifecycle. Components may be split
or replaced, but a peer must observe the same protocol results and ordering as a single coherent participant.

## Requirements and invariants

<a id="inv-sdk-arch-1"></a>
**INV-SDK-ARCH-1 — Coherent participant state.** Services MUST converge on the same channel, fork, peer,
proof, and lifecycle state; no service may privately establish a conflicting protocol truth.

<a id="req-sdk-arch-1"></a>
**REQ-SDK-ARCH-1 — Explicit ownership.** Each mutable operation, state store, external effect, and recovery
decision MUST have one canonical owner and all other components MUST delegate to it.

<a id="req-sdk-arch-2"></a>
**REQ-SDK-ARCH-2 — Ordered lifecycle.** Initialization MUST establish dependencies before accepting work;
shutdown MUST stop intake, settle or reject owned work, release resources, and prevent late callbacks from
mutating disposed state.

<a id="req-sdk-arch-3"></a>
**REQ-SDK-ARCH-3 — Event fidelity.** Public events MUST describe committed participant state transitions,
not speculative intermediate work, and MUST preserve causally significant ordering.

<a id="req-sdk-arch-4"></a>
**REQ-SDK-ARCH-4 — Execution isolation.** Temporary validation, replay, and query work MUST NOT mutate the
live application state or durable protocol state unless the owning operation commits successfully.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `INV-SDK-ARCH-1`        | Coherent participant state. Services MUST converge on the same channel, fork, peer,    |
| `REQ-SDK-ARCH-1`        | Explicit ownership. Each mutable operation, state store, external effect, and recovery |
| `REQ-SDK-ARCH-2`        | Ordered lifecycle. Initialization MUST establish dependencies before accepting work;   |
| `REQ-SDK-ARCH-3`        | Event fidelity. Public events MUST describe committed participant state transitions,   |
| `REQ-SDK-ARCH-4`        | Execution isolation. Temporary validation, replay, and query work MUST NOT mutate the  |

## Assumptions and constraints

- Dependencies expose deterministic typed boundaries and compatible protocol versions.
- A participant may use inline or isolated execution, but observable ordering and failure semantics match.
- Durable storage and chain providers may fail or lag; callers must receive explicit failure or recovery.
- Component boundaries do not imply independent trust: untrusted peer and chain data remains validated.

## Security considerations

Assets include signing authority, live application state, durable proofs, peer identity, and event consumers.
Threats include confused ownership, stale callbacks, partial initialization, split-brain stores, unvalidated
cross-service data, reentrant event handling, and cleanup races. Failure must be contained at the owning
boundary and may not silently advance protocol state.

## Verification and test plan

### Requirement test matrix

| Plan item                                         | Requirements / invariants | Setup and stimulus                                                                                   | Expected result                                                                               | Required permutations                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="inv-sdk-arch-1-t1"></a>`INV-SDK-ARCH-1.T1` | `INV-SDK-ARCH-1`          | Drive the same channel workflow through all cooperating services and inspect every state projection. | Projections agree after success, rejection, retry, and recovery.                              | <a id="inv-sdk-arch-1-t1-p1"></a>`INV-SDK-ARCH-1.T1.P1` — open/execution; <a id="inv-sdk-arch-1-t1-p2"></a>`INV-SDK-ARCH-1.T1.P2` — join/finality; <a id="inv-sdk-arch-1-t1-p3"></a>`INV-SDK-ARCH-1.T1.P3` — dispute/recovery; <a id="inv-sdk-arch-1-t1-p4"></a>`INV-SDK-ARCH-1.T1.P4` — restart.            |
| <a id="req-sdk-arch-1-t1"></a>`REQ-SDK-ARCH-1.T1` | `REQ-SDK-ARCH-1`          | Trigger every mutable operation through each reachable entry path.                                   | All paths delegate to one owner and duplicate delivery cannot create a second effect.         | <a id="req-sdk-arch-1-t1-p1"></a>`REQ-SDK-ARCH-1.T1.P1` — direct/remote/event entry; <a id="req-sdk-arch-1-t1-p2"></a>`REQ-SDK-ARCH-1.T1.P2` — duplicate/concurrent entry; <a id="req-sdk-arch-1-t1-p3"></a>`REQ-SDK-ARCH-1.T1.P3` — owner failure/retry.                                                    |
| <a id="req-sdk-arch-2-t1"></a>`REQ-SDK-ARCH-2.T1` | `REQ-SDK-ARCH-2`          | Initialize and dispose normally and during each dependency or in-flight failure.                     | Intake never precedes readiness; disposal is idempotent and no late mutation occurs.          | <a id="req-sdk-arch-2-t1-p1"></a>`REQ-SDK-ARCH-2.T1.P1` — normal; <a id="req-sdk-arch-2-t1-p2"></a>`REQ-SDK-ARCH-2.T1.P2` — partial init; <a id="req-sdk-arch-2-t1-p3"></a>`REQ-SDK-ARCH-2.T1.P3` — in-flight shutdown; <a id="req-sdk-arch-2-t1-p4"></a>`REQ-SDK-ARCH-2.T1.P4` — repeated disposal/restart. |
| <a id="req-sdk-arch-3-t1"></a>`REQ-SDK-ARCH-3.T1` | `REQ-SDK-ARCH-3`          | Observe events for successful, rejected, retried, and concurrent operations.                         | Only committed outcomes emit and causal order is preserved.                                   | <a id="req-sdk-arch-3-t1-p1"></a>`REQ-SDK-ARCH-3.T1.P1` — success; <a id="req-sdk-arch-3-t1-p2"></a>`REQ-SDK-ARCH-3.T1.P2` — rejection; <a id="req-sdk-arch-3-t1-p3"></a>`REQ-SDK-ARCH-3.T1.P3` — retry/duplicate; <a id="req-sdk-arch-3-t1-p4"></a>`REQ-SDK-ARCH-3.T1.P4` — concurrent causes.              |
| <a id="req-sdk-arch-4-t1"></a>`REQ-SDK-ARCH-4.T1` | `REQ-SDK-ARCH-4`          | Run validation, replay, and queries concurrently with live work, including failures.                 | Temporary work is isolated and only an explicit successful commit changes live/durable state. | <a id="req-sdk-arch-4-t1-p1"></a>`REQ-SDK-ARCH-4.T1.P1` — query; <a id="req-sdk-arch-4-t1-p2"></a>`REQ-SDK-ARCH-4.T1.P2` — replay; <a id="req-sdk-arch-4-t1-p3"></a>`REQ-SDK-ARCH-4.T1.P3` — failure; <a id="req-sdk-arch-4-t1-p4"></a>`REQ-SDK-ARCH-4.T1.P4` — concurrency.                                 |

## Future Work

_Non-normative._ Define a portable participant conformance harness independent of component layout.
