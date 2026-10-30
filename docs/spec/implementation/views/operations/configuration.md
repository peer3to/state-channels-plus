# Protocol Configuration Semantics — Implementation

> **Specification subject:** [Protocol Configuration Semantics](../../../specification/runtime/configuration.md)

## INTEGRATION-TEST-CONFIG-1-9228HJ

- Specification: [`INV-CONFIG-1-0FJ2HX` (Deterministic effective configuration)](../../../specification/runtime/configuration.md#inv-config-1-0fj2hx), [`REQ-CONFIG-1-PDHA8T` (Explicit precedence)](../../../specification/runtime/configuration.md#req-config-1-pdha8t), [`REQ-CONFIG-2-JA2SKN` (Cross-layer compatibility)](../../../specification/runtime/configuration.md#req-config-2-ja2skn), [`REQ-CONFIG-3-J4H12F` (Safe bounds)](../../../specification/runtime/configuration.md#req-config-3-j4h12f)
- Specification tests: All configuration specification tests
- Setup: Start the complete participant with each effective configuration and conflicting source combination.
- Oracle: Startup uses one typed compatible configuration or fails before protocol work without exposing secrets.

- [ ] `INTEGRATION-TEST-CONFIG-1-9228HJ.P1` — valid sources/precedence
- [ ] `INTEGRATION-TEST-CONFIG-1-9228HJ.P2` — invalid values
- [ ] `INTEGRATION-TEST-CONFIG-1-9228HJ.P3` — secret-free failure diagnostics
- [ ] `INTEGRATION-TEST-CONFIG-1-9228HJ.P4` — mismatched values
- [ ] `INTEGRATION-TEST-CONFIG-1-9228HJ.P5` — boundary values
- [ ] `INTEGRATION-TEST-CONFIG-1-9228HJ.P6` — restart after failed startup

## Gaps

- [`REQ-CONFIG-2-JA2SKN` (Cross-layer compatibility)](../../../specification/runtime/configuration.md#req-config-2-ja2skn)
  Missing: `createConfig` carries no protocol version, and no step checks protocol compatibility with the deployment or peers before protocol work begins ([`OQ-34-FY08V2` (RPC boundary decisions)](../../../specification/open-questions.md#oq-34-fy08v2)).
- [`REQ-CONFIG-3-J4H12F` (Safe bounds)](../../../specification/runtime/configuration.md#req-config-3-j4h12f)
  Partial: `createConfig` range-checks only `LOG_QUERY_MAX_BLOCKS` (`assertLogQueryMaxBlocks`), and `coerceEnvValue` silently drops an unparseable environment value ([`FIND-CONFIG-1-WZM0W0`](../../../audit/open-findings.md#find-config-1-wzm0w0)).
