# Runtime Isolation and Concurrency

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

Protocol work may run inline or across isolated execution contexts. Ports, workers, processes, and platform
adapters must preserve the same typed operation, ownership, ordering, error, cancellation, lifecycle, and
serialization semantics as direct execution.

## Requirements and invariants

<a id="inv-runtime-1"></a>
**INV-RUNTIME-1 — Execution equivalence.** Inline and isolated execution given the same inputs and state
MUST produce the same result, committed effects, events, and failure classification.

<a id="req-runtime-1"></a>
**REQ-RUNTIME-1 — Transfer-safe boundary.** Every cross-context value MUST have an explicit canonical
encoding that preserves large integers, binary data, optional branches, errors, and correlation identity.

<a id="req-runtime-2"></a>
**REQ-RUNTIME-2 — Ownership and ordering.** Mutable resources have one context owner; requests affecting the
same ordered domain MUST execute in causal order without late or duplicate completion.

<a id="req-runtime-3"></a>
**REQ-RUNTIME-3 — Lifecycle convergence.** Startup, readiness, failure, cancellation, disposal, and restart
MUST settle every request and release every owned resource exactly once.

<a id="req-runtime-4"></a>
**REQ-RUNTIME-4 — Platform equivalence.** Platform-specific transports and worker mechanisms MAY differ,
but must expose the same protocol behavior and explicitly reject unsupported capabilities.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `INV-RUNTIME-1`         | Execution equivalence. Inline and isolated execution given the same inputs and state     |
| `REQ-RUNTIME-1`         | Transfer-safe boundary. Every cross-context value MUST have an explicit canonical        |
| `REQ-RUNTIME-2`         | Ownership and ordering. Mutable resources have one context owner; requests affecting the |
| `REQ-RUNTIME-3`         | Lifecycle convergence. Startup, readiness, failure, cancellation, disposal, and restart  |
| `REQ-RUNTIME-4`         | Platform equivalence. Platform-specific transports and worker mechanisms MAY differ,     |

## Assumptions and constraints

- Contexts may crash, stall, terminate, or deliver a late response.
- Serialization and message queues impose finite size, memory, and scheduling limits.
- Platform APIs differ; shared semantics cannot depend on an API unavailable in another supported platform.
- Isolation improves fault containment but does not make untrusted protocol data safe.

## Security considerations

Threats include serialization corruption, confused ownership, response mis-correlation, unbounded queues,
use-after-dispose, stale worker mutation, platform drift, and test-control capability leakage. Privileged
control channels must be unavailable in production protocol sessions.

## Verification and test plan

### Requirement test matrix

| Plan item                                       | Requirements / invariants | Setup and stimulus                                                                         | Expected result                                                                | Required permutations                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-runtime-1-t1"></a>`INV-RUNTIME-1.T1` | `INV-RUNTIME-1`           | Execute each public runtime operation inline and isolated with identical state.            | Results, effects, ordering, and errors are equivalent.                         | <a id="inv-runtime-1-t1-p1"></a>`INV-RUNTIME-1.T1.P1` — success; <a id="inv-runtime-1-t1-p2"></a>`INV-RUNTIME-1.T1.P2` — application/transport error; <a id="inv-runtime-1-t1-p3"></a>`INV-RUNTIME-1.T1.P3` — concurrent work; <a id="inv-runtime-1-t1-p4"></a>`INV-RUNTIME-1.T1.P4` — each supported platform. |
| <a id="req-runtime-1-t1"></a>`REQ-RUNTIME-1.T1` | `REQ-RUNTIME-1`           | Round-trip every boundary type and malformed/boundary representation.                      | Canonical values survive exactly; invalid encodings reject before execution.   | <a id="req-runtime-1-t1-p1"></a>`REQ-RUNTIME-1.T1.P1` — bigint/binary; <a id="req-runtime-1-t1-p2"></a>`REQ-RUNTIME-1.T1.P2` — nested/optional; <a id="req-runtime-1-t1-p3"></a>`REQ-RUNTIME-1.T1.P3` — errors; <a id="req-runtime-1-t1-p4"></a>`REQ-RUNTIME-1.T1.P4` — malformed/size boundary.                |
| <a id="req-runtime-2-t1"></a>`REQ-RUNTIME-2.T1` | `REQ-RUNTIME-2`           | Race ordered, unordered, duplicate, and cancelled operations across contexts.              | Owners serialize required work and ignore stale/duplicate completions.         | <a id="req-runtime-2-t1-p1"></a>`REQ-RUNTIME-2.T1.P1` — ordered domain; <a id="req-runtime-2-t1-p2"></a>`REQ-RUNTIME-2.T1.P2` — independent domains; <a id="req-runtime-2-t1-p3"></a>`REQ-RUNTIME-2.T1.P3` — duplicate/late; <a id="req-runtime-2-t1-p4"></a>`REQ-RUNTIME-2.T1.P4` — cancellation race.         |
| <a id="req-runtime-3-t1"></a>`REQ-RUNTIME-3.T1` | `REQ-RUNTIME-3`           | Fail or terminate at every startup and in-flight phase, then dispose/restart.              | Every request settles once and resources are reclaimed without stale mutation. | <a id="req-runtime-3-t1-p1"></a>`REQ-RUNTIME-3.T1.P1` — startup/readiness; <a id="req-runtime-3-t1-p2"></a>`REQ-RUNTIME-3.T1.P2` — crash/stall; <a id="req-runtime-3-t1-p3"></a>`REQ-RUNTIME-3.T1.P3` — disposal; <a id="req-runtime-3-t1-p4"></a>`REQ-RUNTIME-3.T1.P4` — restart.                              |
| <a id="req-runtime-4-t1"></a>`REQ-RUNTIME-4.T1` | `REQ-RUNTIME-4`           | Run equivalent workflows on every supported platform and request unsupported capabilities. | Observable protocol behavior agrees; unsupported behavior rejects explicitly.  | <a id="req-runtime-4-t1-p1"></a>`REQ-RUNTIME-4.T1.P1` — each platform; <a id="req-runtime-4-t1-p2"></a>`REQ-RUNTIME-4.T1.P2` — transport replacement; <a id="req-runtime-4-t1-p3"></a>`REQ-RUNTIME-4.T1.P3` — unsupported capability.                                                                           |

## Future Work

_Non-normative._ Standardize resource budgets and scheduling fairness targets by deployment class.
