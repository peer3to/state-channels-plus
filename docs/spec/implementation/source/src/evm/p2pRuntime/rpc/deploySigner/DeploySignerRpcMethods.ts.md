# DeploySignerRpcMethods.ts — Source Report

> **Source:** [DeploySignerRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/deploySigner/DeploySignerRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

The deploy signer's operations as endpoints: address, nonce, name resolution, a call, and a deploy
transaction that is mined before it is answered.

## Key design decisions

- **A deploy reply is the mined transaction**, hash, addresses, data and receipt, so the bridge
  signer's `wait()` has nothing left to wait for.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                            |
| ------------ | ------------------------------------------------------------------- |
| Inputs       | Transaction requests; a name.                                       |
| Outputs      | Address, nonce, resolved name, call result, a deployed transaction. |
| Owned state  | None.                                                               |
| Side effects | Deploys into the host's local VM.                                   |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                           | Specification IDs                                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [DeploySignerRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/deploySigner/DeploySignerRpcMethods.ts) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

## Assumptions, dependencies, trust boundaries, and limits

- Only the setup phase calls these; the host is reachable before `deployComplete`.

## Specification adherence

- The local VM has one owner ({{REQ:[`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                | Implementation status | Evidence                                            | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** every method ends on `host.deploySigner`. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [DeploySignerService.ts.md](./DeploySignerService.ts.md)
- [../../../signer/DeploymentBridgeSigner.ts.md](../../../signer/DeploymentBridgeSigner.ts.md) — the caller.
