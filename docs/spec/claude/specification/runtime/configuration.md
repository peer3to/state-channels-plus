# Protocol Configuration Semantics

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

Configuration selects protocol timing, chain, transport, persistence, runtime, and resource behavior before
a participant accepts work. Equivalent effective configuration must have one unambiguous meaning across
participants and execution environments.

## Requirements and invariants

<a id="inv-config-1"></a>
**INV-CONFIG-1 — Deterministic effective configuration.** The same declared inputs and precedence rules MUST
produce the same typed effective configuration; unknown, ambiguous, or invalid values MUST NOT be guessed.

<a id="req-config-1"></a>
**REQ-CONFIG-1 — Explicit precedence.** Every source of configuration MUST have a documented precedence and
coercion rule, and security-sensitive values MUST identify their provenance without exposing secrets.

<a id="req-config-2"></a>
**REQ-CONFIG-2 — Cross-layer compatibility.** Chain identity, contract addresses, timing windows, encodings,
protocol version, and transport/runtime choices MUST be mutually compatible before protocol work begins.

<a id="req-config-3"></a>
**REQ-CONFIG-3 — Safe bounds.** Timing, memory, concurrency, payload, retry, and persistence values MUST
reject unsafe or unsupported ranges rather than silently clamping to a behavior peers cannot predict.

This table is the normative requirement index. Detailed rules and rationale are defined above.

| Requirement / invariant | Statement                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `INV-CONFIG-1`          | Deterministic effective configuration. The same declared inputs and precedence rules MUST |
| `REQ-CONFIG-1`          | Explicit precedence. Every source of configuration MUST have a documented precedence and  |
| `REQ-CONFIG-2`          | Cross-layer compatibility. Chain identity, contract addresses, timing windows, encodings, |
| `REQ-CONFIG-3`          | Safe bounds. Timing, memory, concurrency, payload, retry, and persistence values MUST     |

## Assumptions and constraints

- Deployment operators control local configuration but not remote peer configuration.
- Secrets may be referenced by configuration but must not be logged, serialized to peers, or committed.
- Some defaults are development conveniences and are not automatically safe production parameters.
- Configuration that affects protocol interpretation must be agreed or discoverably compatible.

## Security considerations

Threats include secret disclosure, environment-string coercion errors, precedence confusion, wrong-chain or
wrong-contract operation, dangerously short windows, unbounded resource settings, and peer incompatibility.
Startup must fail before signing or mutating durable state when compatibility cannot be established.

## Verification and test plan

### Requirement test matrix

| Plan item                                     | Requirements / invariants | Setup and stimulus                                                                                    | Expected result                                                                           | Required permutations                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-config-1-t1"></a>`INV-CONFIG-1.T1` | `INV-CONFIG-1`            | Resolve every field from defaults and each supported input source in isolation and combination.       | Effective typed values and provenance are deterministic; invalid/unknown values reject.   | <a id="inv-config-1-t1-p1"></a>`INV-CONFIG-1.T1.P1` — each source; <a id="inv-config-1-t1-p2"></a>`INV-CONFIG-1.T1.P2` — precedence conflicts; <a id="inv-config-1-t1-p3"></a>`INV-CONFIG-1.T1.P3` — type boundaries; <a id="inv-config-1-t1-p4"></a>`INV-CONFIG-1.T1.P4` — unknown/missing.               |
| <a id="req-config-1-t1"></a>`REQ-CONFIG-1.T1` | `REQ-CONFIG-1`            | Inspect effective configuration diagnostics with ordinary and secret values.                          | Provenance is clear and secret material never appears in output or errors.                | <a id="req-config-1-t1-p1"></a>`REQ-CONFIG-1.T1.P1` — default/file/environment/argument; <a id="req-config-1-t1-p2"></a>`REQ-CONFIG-1.T1.P2` — overridden secret; <a id="req-config-1-t1-p3"></a>`REQ-CONFIG-1.T1.P3` — parse failure.                                                                     |
| <a id="req-config-2-t1"></a>`REQ-CONFIG-2.T1` | `REQ-CONFIG-2`            | Start with matching and mismatched chain, contract, timing, version, transport, and runtime settings. | Compatible configuration starts; every mismatch fails before protocol work.               | <a id="req-config-2-t1-p1"></a>`REQ-CONFIG-2.T1.P1` — matching; <a id="req-config-2-t1-p2"></a>`REQ-CONFIG-2.T1.P2` — each mismatch; <a id="req-config-2-t1-p3"></a>`REQ-CONFIG-2.T1.P3` — remote-version disagreement; <a id="req-config-2-t1-p4"></a>`REQ-CONFIG-2.T1.P4` — restart with changed config. |
| <a id="req-config-3-t1"></a>`REQ-CONFIG-3.T1` | `REQ-CONFIG-3`            | Supply zero, minimum, typical, maximum, and one-beyond values for every bounded field.                | Supported boundaries are exact; unsafe/unsupported values reject with no partial startup. | <a id="req-config-3-t1-p1"></a>`REQ-CONFIG-3.T1.P1` — timing; <a id="req-config-3-t1-p2"></a>`REQ-CONFIG-3.T1.P2` — memory/concurrency/payload; <a id="req-config-3-t1-p3"></a>`REQ-CONFIG-3.T1.P3` — retry/persistence; <a id="req-config-3-t1-p4"></a>`REQ-CONFIG-3.T1.P4` — interacting bounds.         |

## Future Work

_Non-normative._ Define deployment profiles with empirically validated production bounds.
