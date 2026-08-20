# ObjectChecks.ts — Source Report

> **Source:** [src/utils/ObjectChecks.ts](../../../../../../src/utils/ObjectChecks.ts) > **Status:** Authored — engineer verification pending.
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

Shared prototype-aware property, method, RPC-service, and ethers-Result public-shape checks used at
runtime classification and conversion boundaries. They do not authorize wire-visible RPC method names.

## Key design decisions

1. **Public shapes include prototype members.** `hasProperty` uses `in` and `hasMethod` adds a function check, so class methods remain visible across compatible values ([#L8](../../../../../../src/utils/ObjectChecks.ts#L8), [#L19](../../../../../../src/utils/ObjectChecks.ts#L19)).
2. **Cross-module values are structural.** `hasRpcService` checks the complete service operations used by dispatch, while `isEthersResult` checks the array and named-conversion API exposed by ethers; neither depends on one bundle's constructor ([#L31](../../../../../../src/utils/ObjectChecks.ts#L31), [#L51](../../../../../../src/utils/ObjectChecks.ts#L51)).
3. **Authorization is separate.** Attacker-controlled endpoint names are resolved by [ARpcService](../rpc/ARpcService.ts.md), not by these reusable shape predicates.
4. **Lookup uses normal JavaScript semantics.** Object-prototype methods count as inherited structural methods. Accessors and proxy traps run during lookup, and their exceptions propagate; these helpers do not suppress or retry caller-owned behavior.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Unknown values plus a property name for property, method, and service checks.                                                                                               |
| Outputs      | Boolean type-guard results for public properties, methods, service shapes, and ethers Result shapes.                                                                        |
| Owned state  | None.                                                                                                                                                                       |
| Side effects | Lookup may traverse prototypes and execute accessors or proxy traps. Their exceptions propagate. The helpers do not mutate values or grant transport/RPC access themselves. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                    | Specification IDs                                                                                                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ObjectChecks.ts](../../../../../../src/utils/ObjectChecks.ts) | [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0), [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.
- The checked method set is the minimum stable public contract consumed by the caller; a shape check
  does not grant peer trust, authorize an RPC endpoint, or skip RPC guards.
- Callers provide stable local structural values. Accessor and proxy-trap side effects belong to those
  values and are not isolated by these predicates.

## Specification adherence

- Compatible services and ethers results remain recognizable across production module graphs without
  weakening rejection of incomplete values.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                        | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)    | Covered               | **Here:** `hasRpcService` requires the public service operations and rejects incomplete values. | None.            |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** service and ethers-result predicates do not depend on constructor identity.           | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                    | Obligation                       | Public entry and setup                                                         | Oracle and forbidden effects                                                       | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-object-checks-1-bhaqsx"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX` | Method and compatible-shape core | Exercise callable properties plus compatible service and Result values         | Callable public shapes pass; missing/non-functions fail without constructor checks | <a id="unit-test-object-checks-1-bhaqsx.p1"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P1` — own method; <a id="unit-test-object-checks-1-bhaqsx.p2"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P2` — inherited method; <a id="unit-test-object-checks-1-bhaqsx.p3"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P3` — non-function, missing, and non-object method inputs; <a id="unit-test-object-checks-1-bhaqsx.p4"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P4` — complete cross-module RPC service; <a id="unit-test-object-checks-1-bhaqsx.p5"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P5` — missing `createRPCMethods`; <a id="unit-test-object-checks-1-bhaqsx.p6"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P6` — native and cross-module ethers Result; <a id="unit-test-object-checks-1-bhaqsx.p7"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P7` — ordinary array without Result API; <a id="unit-test-object-checks-1-bhaqsx.p8"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P8` — proxy-wrapped ethers Result; <a id="unit-test-object-checks-1-bhaqsx.p9"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P9` — Object-prototype methods remain structural methods; <a id="unit-test-object-checks-1-bhaqsx.p10"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P10` — callable accessor evaluated once and accepted; <a id="unit-test-object-checks-1-bhaqsx.p11"></a>`UNIT-TEST-OBJECT-CHECKS-1-BHAQSX.P11` — throwing method accessor propagates |
| <a id="unit-test-object-checks-2-vmpcb5"></a>`UNIT-TEST-OBJECT-CHECKS-2-VMPCB5` | Property boundaries              | Check own/inherited, missing, null, primitive, and function-valued inputs      | Only object values exposing the named own or inherited property pass               | <a id="unit-test-object-checks-2-vmpcb5.p1"></a>`UNIT-TEST-OBJECT-CHECKS-2-VMPCB5.P1` — own and inherited properties; <a id="unit-test-object-checks-2-vmpcb5.p2"></a>`UNIT-TEST-OBJECT-CHECKS-2-VMPCB5.P2` — missing and non-object values rejected; <a id="unit-test-object-checks-2-vmpcb5.p3"></a>`UNIT-TEST-OBJECT-CHECKS-2-VMPCB5.P3` — throwing proxy `has` trap propagates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| <a id="unit-test-object-checks-3-3jxmp5"></a>`UNIT-TEST-OBJECT-CHECKS-3-3JXMP5` | RPC-service rejection branches   | Remove or corrupt each operation in an otherwise complete public service shape | Missing service operations and invalid service/manager value kinds reject          | <a id="unit-test-object-checks-3-3jxmp5.p1"></a>`UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P1` — missing/null/primitive/function service; <a id="unit-test-object-checks-3-3jxmp5.p2"></a>`UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P2` — non-callable `createRPCMethods`; <a id="unit-test-object-checks-3-3jxmp5.p3"></a>`UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P3` — missing/null/primitive/function `p2pManager`; <a id="unit-test-object-checks-3-3jxmp5.p4"></a>`UNIT-TEST-OBJECT-CHECKS-3-3JXMP5.P4` — missing/non-callable `runRPC`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| <a id="unit-test-object-checks-4-nvx8ke"></a>`UNIT-TEST-OBJECT-CHECKS-4-NVX8KE` | Result rejection branches        | Corrupt the array requirement and each required Result method                  | Non-arrays and arrays with missing/non-callable Result operations reject           | <a id="unit-test-object-checks-4-nvx8ke.p1"></a>`UNIT-TEST-OBJECT-CHECKS-4-NVX8KE.P1` — method-shaped non-array/null/primitive rejected; <a id="unit-test-object-checks-4-nvx8ke.p2"></a>`UNIT-TEST-OBJECT-CHECKS-4-NVX8KE.P2` — each missing Result method; <a id="unit-test-object-checks-4-nvx8ke.p3"></a>`UNIT-TEST-OBJECT-CHECKS-4-NVX8KE.P3` — each non-callable Result method                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Related source reports

- [ARpcService](../rpc/ARpcService.ts.md).
