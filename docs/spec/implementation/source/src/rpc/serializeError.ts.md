# serializeError.ts — Source Report

> **Source:** [serializeError.ts](../../../../../../src/rpc/serializeError.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Responsibility and observable boundary

The one owner of how an error crosses a trusted line and comes back: name, message, stack, a
contract revert's `data`, ethers' classification fields, and the originating peer's stamp. Peers get
only the message; this shape is for this process's own threads, which need to classify what happened.

## Key design decisions

- **One serializer, one deserializer, one file.** The host used to write and the client to read;
  drift between them was a matter of time.
- **Revert data is dug out of every shape ethers uses**, so a custom error decodes on the far side.
- **Ethers metadata is cloned defensively** through `toJSON` and `structuredClone`, and dropped when
  it cannot be cloned rather than failing the reply.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Inputs       | Any thrown value; a serialized error from a reply.                                                   |
| Outputs      | A transfer-safe `SerializedError`; an `Error` with the fields restored and the peer stamp reapplied. |
| Owned state  | None.                                                                                                |
| Side effects | None.                                                                                                |

## Linked requirements

| Source file                                                      | Specification IDs                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [serializeError.ts](../../../../../../src/rpc/serializeError.ts) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) |

## Assumptions, dependencies, trust boundaries, and limits

- A reply from a peer carries a string; `errorFromReply` handles both shapes.
- What cannot be cloned is dropped, never thrown on.

## Specification adherence

- A failed reply crosses a context boundary in one explicit, transfer-safe shape ({{REQ:[`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)}}).

## Conformance traceability

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                 | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** `serializeError` / `deserializeError` are the canonical pair. **Other files:** [ARpcService.ts.md](./ARpcService.ts.md) applies it on trusted transports only. | None.            |

## Related source reports

- [ARpcService.ts.md](./ARpcService.ts.md) — serializes a handler failure for a trusted caller.
- [ARpcRouter.ts.md](./ARpcRouter.ts.md) — restores it for the awaiting caller.
