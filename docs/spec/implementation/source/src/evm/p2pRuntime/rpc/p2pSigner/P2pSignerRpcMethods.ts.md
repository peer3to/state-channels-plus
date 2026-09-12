# P2pSignerRpcMethods.ts — Source Report

> **Source:** [P2pSignerRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/p2pSigner/P2pSignerRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The p2p signer's operations as endpoints: send a transaction into the channel, a read-only call,
connect, join, top up, collect a join confirmation, set the channel id, read the status, sign a
message or typed data, and the leader flag and peer disconnect.

## Key design decisions

- **Structs cross encoded.** Join confirmations and join requests are `Codec`-encoded strings on the
  wire and decoded here, as the encoding rule requires.
- **`Promise<void>` is still a reply.** Every mutating endpoint returns `Promise<void>` so the
  caller can await "done" — `setIsLeader` and `disconnectFromPeers` included, so a host that cannot
  serve them reaches the caller rather than only the log.
- **Typed data crosses as its own types.** `signTypedData` takes the ethers domain, types and value
  parameters directly; they are structured-clone-safe, so nothing is cast.
- **A message is tagged, never sniffed.** `signMessage` takes the same `SignerMessage` the chain
  signer takes and decodes through its owner, so the UTF-8 text `"0xdeadbeef"` is no longer signed
  as the four bytes it resembles.

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
