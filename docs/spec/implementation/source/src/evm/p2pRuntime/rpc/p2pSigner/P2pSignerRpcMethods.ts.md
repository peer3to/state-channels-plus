# P2pSignerRpcMethods.ts — Source Report

> **Source:** [P2pSignerRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/p2pSigner/P2pSignerRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

| Source file                                                                                                  | Specification IDs                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [P2pSignerRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/p2pSigner/P2pSignerRpcMethods.ts) | [`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3), [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) |

## Assumptions, dependencies, trust boundaries, and limits

- Before `deployComplete` every channel operation throws `Runtime is not ready`; signing works from the start.

## Specification adherence

- The key never crosses; the client sends what to sign ({{REQ:[`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)}}).
- Every struct crosses in its canonical encoded form ({{REQ:[`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                    | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------- | ---------------- |
| [`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)     | Covered               | **Here:** `signMessage` / `signTypedData` on the host wallet.               | None.            |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** `Codec.decode` on entry, `Codec.encode` on exit for every struct. | None.            |

## Related source reports

- [P2pSignerService.ts.md](./P2pSignerService.ts.md)
- [../../../signer/ClientP2pSigner.ts.md](../../../signer/ClientP2pSigner.ts.md) — the facade that calls these.
