# ARpcService.ts — Source Report

> **Source:** [src/rpc/ARpcService.ts](../../../../../../src/rpc/ARpcService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

The service base class: guard evaluation, method resolution, and handler invocation for one
dispatched frame — the last three stages of the ingress dispatch order. Subclasses declare
`guards` and a per-dispatch `createRPCMethods(../transport)` factory.

## Key design decisions

1. **Guards run before method-existence disclosure.** An unauthenticated probe on a gated service hits the guard consequence even for nonexistent methods, learning nothing ([#L25](../../../../../../src/rpc/ARpcService.ts#L25)).
2. **Trusted-loopback exemption.** Guards are skipped only when `transport.isTrusted` — true solely for self-delivery ([#L26](../../../../../../src/rpc/ARpcService.ts#L26)).
3. **Handler errors answer, they don't disconnect.** On the request path a thrown handler error returns `{ok:false}` so the caller's promise rejects while the session survives; fire-and-forget errors escalate to disconnect ([#L47](../../../../../../src/rpc/ARpcService.ts#L47)).
4. **Guard failure still settles requests.** A refused request gets a deterministic `rejected by guard` response instead of a timeout ([#L30](../../../../../../src/rpc/ARpcService.ts#L30)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                   |
| ------------ | -------------------------------------------------------------------------- |
| Inputs       | Decoded `Rpc` + sender transport (from the dispatcher).                    |
| Outputs      | Handler invocation; correlated responses; boolean keep-connection verdict. |
| Owned state  | Guard array (per subclass); nothing per-call.                              |
| Side effects | Response sends on the arriving transport.                                  |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                | Specification IDs                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [ARpcService.ts](../../../../../../src/rpc/ARpcService.ts) | [`INV-RPC-1-SJS2T6`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6), [`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm), [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j), [`REQ-RPC-7-9CBSHK`](../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) |

## Assumptions, dependencies, trust boundaries, and limits

- The dispatcher already bounded, classified, and envelope-verified the frame; this class owns stages 5–7 of the order.
- RpcMethods instances are per-dispatch and stateless beyond the sender transport.

## Specification adherence

- Guards-before-method-existence and per-stage consequences ([`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)).
- Deterministic guard-refusal settlement and loopback-only bypass ([`REQ-RPC-7-9CBSHK`](../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)).

## Specification contradictions

**[`DEF-7-PK564B`](../../../../audit/open-findings.md#def-7-pk564b) lives at this boundary's method check:** `hasMethod` accepts prototype-inherited names, so `toString`/`constructor` are remotely callable on every RpcMethods class — fix belongs in [ObjectChecks](../utils/ObjectChecks.ts.md) with an own-property + function check ([open-findings](../../../../audit/open-findings.md)).

## Missing behavior

**[`DEF-8-HWJ10N`](../../../../audit/open-findings.md#def-8-hwj10n):** a `sendRpcResponse` throw inside the catch path escapes as an unhandled rejection on closed transports — the reply send needs its own guard ([open-findings](../../../../audit/open-findings.md)). Guard-retry semantics for request-style calls remain the [`OQ-34-FY08V2`](../../../../specification/open-questions.md#oq-34-fy08v2) decision.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                                                                                                             | Gap / divergence                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) | Partial               | **Here:** guard ordering, method resolution, invocation, consequence split ([#L25](../../../../../../src/rpc/ARpcService.ts#L25)). **Other files:** stages 1–4 in [P2PManager](../P2PManager.ts.md). | [`DEF-7-PK564B`](../../../../audit/open-findings.md#def-7-pk564b): method-existence check accepts prototype-inherited names (remotely callable built-ins). |
| [`REQ-RPC-7-9CBSHK`](../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) | Covered               | **Here:** declaration-order short-circuit via [runGuards](./guards/runGuards.ts.md), trusted-only bypass, deterministic request settlement.                                                          | None.                                                                                                                                                      |
| [`REQ-RPC-2-SZDTTM`](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm) | Partial               | **Here:** at-most-once reply per requestId on this side. **Other files:** correlation table in [P2PManager](../P2PManager.ts.md).                                                                    | [`DEF-8-HWJ10N`](../../../../audit/open-findings.md#def-8-hwj10n): reply-send failure on a closed transport escapes unhandled.                             |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                  | Obligation                           | Public entry and setup                                                                                                    | Oracle and forbidden effects                                                                                                                                                                                      | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-arpc-service-1-s4t98z"></a>`UNIT-TEST-ARPC-SERVICE-1-S4T98Z` | Dispatch-order tail and consequences | Drive guarded/unguarded services over trusted and untrusted transports with existing, missing, and inherited method names | Guard-first ordering; loopback bypass only; request errors answer while fire-and-forget errors disconnect; inherited-name behavior documented ([`DEF-7-PK564B`](../../../../audit/open-findings.md#def-7-pk564b)) | <a id="unit-test-arpc-service-1-s4t98z.p1"></a>`UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P1` — guard failure settles request; <a id="unit-test-arpc-service-1-s4t98z.p2"></a>`UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P2` — loopback guard bypass; <a id="unit-test-arpc-service-1-s4t98z.p3"></a>`UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P3` — missing method → false; <a id="unit-test-arpc-service-1-s4t98z.p4"></a>`UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P4` — inherited method name (documents [`DEF-7-PK564B`](../../../../audit/open-findings.md#def-7-pk564b)); <a id="unit-test-arpc-service-1-s4t98z.p5"></a>`UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P5` — handler throw on request; <a id="unit-test-arpc-service-1-s4t98z.p6"></a>`UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P6` — network transport guards run; <a id="unit-test-arpc-service-1-s4t98z.p7"></a>`UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P7` — handler throw on fire-and-forget |

## Related source reports

- [guards/runGuards](./guards/runGuards.ts.md), [guards/HandshakeCompletedGuard](./guards/HandshakeCompletedGuard.ts.md), [P2PManager](../P2PManager.ts.md), [ObjectChecks](../utils/ObjectChecks.ts.md).
