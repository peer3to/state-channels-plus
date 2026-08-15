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

**<a id="inv-config-1-0fj2hx"></a>`INV-CONFIG-1-0FJ2HX` — Deterministic effective configuration.** The same declared inputs and precedence rules MUST
produce the same typed effective configuration; unknown, ambiguous, or invalid values MUST NOT be guessed.

**<a id="req-config-1-pdha8t"></a>`REQ-CONFIG-1-PDHA8T` — Explicit precedence.** Every source of configuration MUST have a documented precedence and
coercion rule, and security-sensitive values MUST identify their provenance without exposing secrets.

**<a id="req-config-2-ja2skn"></a>`REQ-CONFIG-2-JA2SKN` — Cross-layer compatibility.** Chain identity, contract addresses, timing windows, encodings,
protocol version, and transport/runtime choices MUST be mutually compatible before protocol work begins.

**<a id="req-config-3-j4h12f"></a>`REQ-CONFIG-3-J4H12F` — Safe bounds.** Timing, memory, concurrency, payload, retry, and persistence values MUST
reject unsafe or unsupported ranges rather than silently clamping to a behavior peers cannot predict.

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

| Plan item                                                   | Requirements / invariants                                     | Setup and stimulus                                                                                    | Expected result                                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-config-1-0fj2hx.t1"></a>`INV-CONFIG-1-0FJ2HX.T1` | [`INV-CONFIG-1-0FJ2HX`](configuration.md#inv-config-1-0fj2hx) | Resolve every field from defaults and each supported input source in isolation and combination.       | Effective typed values and provenance are deterministic; invalid/unknown values reject.   | <a id="inv-config-1-0fj2hx.t1.p1"></a>`INV-CONFIG-1-0FJ2HX.T1.P1` — defaults source; <a id="inv-config-1-0fj2hx.t1.p5"></a>`INV-CONFIG-1-0FJ2HX.T1.P5` — file source; <a id="inv-config-1-0fj2hx.t1.p6"></a>`INV-CONFIG-1-0FJ2HX.T1.P6` — environment source; <a id="inv-config-1-0fj2hx.t1.p7"></a>`INV-CONFIG-1-0FJ2HX.T1.P7` — argument source; <a id="inv-config-1-0fj2hx.t1.p2"></a>`INV-CONFIG-1-0FJ2HX.T1.P2` — precedence conflicts; <a id="inv-config-1-0fj2hx.t1.p3"></a>`INV-CONFIG-1-0FJ2HX.T1.P3` — type boundaries; <a id="inv-config-1-0fj2hx.t1.p4"></a>`INV-CONFIG-1-0FJ2HX.T1.P4` — unknown value; <a id="inv-config-1-0fj2hx.t1.p8"></a>`INV-CONFIG-1-0FJ2HX.T1.P8` — missing value.                                                                                                                      |
| <a id="req-config-1-pdha8t.t1"></a>`REQ-CONFIG-1-PDHA8T.T1` | [`REQ-CONFIG-1-PDHA8T`](configuration.md#req-config-1-pdha8t) | Inspect effective configuration diagnostics with ordinary and secret values.                          | Provenance is clear and secret material never appears in output or errors.                | <a id="req-config-1-pdha8t.t1.p1"></a>`REQ-CONFIG-1-PDHA8T.T1.P1` — default provenance; <a id="req-config-1-pdha8t.t1.p4"></a>`REQ-CONFIG-1-PDHA8T.T1.P4` — file provenance; <a id="req-config-1-pdha8t.t1.p5"></a>`REQ-CONFIG-1-PDHA8T.T1.P5` — environment provenance; <a id="req-config-1-pdha8t.t1.p6"></a>`REQ-CONFIG-1-PDHA8T.T1.P6` — argument provenance; <a id="req-config-1-pdha8t.t1.p2"></a>`REQ-CONFIG-1-PDHA8T.T1.P2` — overridden secret; <a id="req-config-1-pdha8t.t1.p3"></a>`REQ-CONFIG-1-PDHA8T.T1.P3` — parse failure.                                                                                                                                                                                                                                                                                  |
| <a id="req-config-2-ja2skn.t1"></a>`REQ-CONFIG-2-JA2SKN.T1` | [`REQ-CONFIG-2-JA2SKN`](configuration.md#req-config-2-ja2skn) | Start with matching and mismatched chain, contract, timing, version, transport, and runtime settings. | Compatible configuration starts; every mismatch fails before protocol work.               | <a id="req-config-2-ja2skn.t1.p1"></a>`REQ-CONFIG-2-JA2SKN.T1.P1` — matching; <a id="req-config-2-ja2skn.t1.p2"></a>`REQ-CONFIG-2-JA2SKN.T1.P2` — chain mismatch; <a id="req-config-2-ja2skn.t1.p5"></a>`REQ-CONFIG-2-JA2SKN.T1.P5` — contract mismatch; <a id="req-config-2-ja2skn.t1.p6"></a>`REQ-CONFIG-2-JA2SKN.T1.P6` — timing mismatch; <a id="req-config-2-ja2skn.t1.p7"></a>`REQ-CONFIG-2-JA2SKN.T1.P7` — version mismatch; <a id="req-config-2-ja2skn.t1.p8"></a>`REQ-CONFIG-2-JA2SKN.T1.P8` — transport mismatch; <a id="req-config-2-ja2skn.t1.p9"></a>`REQ-CONFIG-2-JA2SKN.T1.P9` — runtime-settings mismatch; <a id="req-config-2-ja2skn.t1.p3"></a>`REQ-CONFIG-2-JA2SKN.T1.P3` — remote-version disagreement; <a id="req-config-2-ja2skn.t1.p4"></a>`REQ-CONFIG-2-JA2SKN.T1.P4` — restart with changed config. |
| <a id="req-config-3-j4h12f.t1"></a>`REQ-CONFIG-3-J4H12F.T1` | [`REQ-CONFIG-3-J4H12F`](configuration.md#req-config-3-j4h12f) | Supply zero, minimum, typical, maximum, and one-beyond values for every bounded field.                | Supported boundaries are exact; unsafe/unsupported values reject with no partial startup. | <a id="req-config-3-j4h12f.t1.p1"></a>`REQ-CONFIG-3-J4H12F.T1.P1` — timing; <a id="req-config-3-j4h12f.t1.p2"></a>`REQ-CONFIG-3-J4H12F.T1.P2` — memory bounds; <a id="req-config-3-j4h12f.t1.p5"></a>`REQ-CONFIG-3-J4H12F.T1.P5` — concurrency bounds; <a id="req-config-3-j4h12f.t1.p6"></a>`REQ-CONFIG-3-J4H12F.T1.P6` — payload bounds; <a id="req-config-3-j4h12f.t1.p3"></a>`REQ-CONFIG-3-J4H12F.T1.P3` — retry bounds; <a id="req-config-3-j4h12f.t1.p7"></a>`REQ-CONFIG-3-J4H12F.T1.P7` — persistence bounds; <a id="req-config-3-j4h12f.t1.p4"></a>`REQ-CONFIG-3-J4H12F.T1.P4` — interacting bounds.                                                                                                                                                                                                                 |

## Future Work

_Non-normative._ Define deployment profiles with empirically validated production bounds.
