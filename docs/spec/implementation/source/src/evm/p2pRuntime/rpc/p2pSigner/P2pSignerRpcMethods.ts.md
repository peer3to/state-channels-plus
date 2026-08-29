# P2pSignerRpcMethods.ts — Source Report

> **Source:** [P2pSignerRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/p2pSigner/P2pSignerRpcMethods.ts) > **Status:** Authored — engineer verification pending.
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

The p2p signer's operations as endpoints: send a transaction into the channel, a read-only call,
connect, join, top up, collect a join confirmation, set the channel id, read the status, sign a
message or typed data, and the two flags nobody waits on.

## Key design decisions

- **Structs cross encoded.** Join confirmations and join requests are `Codec`-encoded strings on the
  wire and decoded here, as the encoding rule requires.
- **`Promise<void>` is still a reply.** `sendTransaction`, `connectToChannel`, `joinChannel`,
  `topUpBalance` and `setChannelId` return `Promise<void>` so the caller can await "done"; only
  `setIsLeader` and `disconnectFromPeers` are `void`, and so casts.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                             |
| ------------ | -------------------------------------------------------------------- |
| Inputs       | Hex calldata, encoded structs, channel ids, messages.                |
| Outputs      | Hex results, an encoded prepared confirmation, a status, signatures. |
| Owned state  | None.                                                                |
| Side effects | Everything the host's p2p signer does.                               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                  | Specification IDs                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [P2pSignerRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/p2pSigner/P2pSignerRpcMethods.ts) | [`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3), [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) |

## Assumptions, dependencies, trust boundaries, and limits

- Before `deployComplete` every channel operation throws `Runtime is not ready`; signing works from the start.

## Specification adherence

- The key never crosses; the client sends what to sign ({{REQ:[`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)}}).
- Every struct crosses in its canonical encoded form ({{REQ:[`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                    | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------- | ---------------- |
| [`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)     | Covered               | **Here:** `signMessage` / `signTypedData` on the host wallet.               | None.            |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** `Codec.decode` on entry, `Codec.encode` on exit for every struct. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [P2pSignerService.ts.md](./P2pSignerService.ts.md)
- [../../../signer/ClientP2pSigner.ts.md](../../../signer/ClientP2pSigner.ts.md) — the facade that calls these.
