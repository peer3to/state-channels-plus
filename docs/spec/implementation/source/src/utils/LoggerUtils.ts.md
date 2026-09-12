# LoggerUtils.ts — Source Report

> **Source:** [src/utils/LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../views/architecture/sdk/components.md)

## Responsibility and observable boundary

Structured-log formatting helpers (dispute/auditing metadata projections, hash formatting, transport metadata that names the channel only when the transport's router is a peer manager).

## Linked requirements

| Source file                                                  | Specification IDs |
| ------------------------------------------------------------ | ----------------- |
| [LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts) |                   |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Role-consistent with the owning views.

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- Consumers per the views.

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation                    | Public entry and setup                                                                                                                    | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-logger-utils-32-wmbbza"></a>`UNIT-TEST-LOGGER-UTILS-32-WMBBZA` | Enum and failed time metadata | Use a real logger store and captured time; inspect exact enum output, severity, message and metadata including optional prior timestamps. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-logger-utils-32-wmbbza.p1"></a>`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P1` — formats known and unknown numeric enum members without changing strings; <a id="unit-test-logger-utils-32-wmbbza.p2"></a>`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P2` — logs objective time failure using captured time and previous timestamps; <a id="unit-test-logger-utils-32-wmbbza.p3"></a>`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P3` — omits previous timestamp fields for subjective time failures |
