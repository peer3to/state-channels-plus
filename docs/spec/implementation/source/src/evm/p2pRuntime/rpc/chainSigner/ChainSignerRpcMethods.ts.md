# ChainSignerRpcMethods.ts — Source Report

> **Source:** [ChainSignerRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/chainSigner/ChainSignerRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The chain signer's operations as endpoints: sign or send a serialized transaction, sign a message
given as text or hex bytes, sign typed data.

## Key design decisions

- **Transactions cross in their serialized form** and responses in theirs, through the existing
  serialization module; nothing is re-encoded here.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                       |
| ------------ | -------------------------------------------------------------- |
| Inputs       | Serialized transaction requests; a tagged message; typed data. |
| Outputs      | Signatures; a serialized transaction response.                 |
| Owned state  | None.                                                          |
| Side effects | On-chain sends through the host's nonce manager.               |

## Linked requirements

| Source file                                                                                                        | Specification IDs                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ChainSignerRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/chainSigner/ChainSignerRpcMethods.ts) | [`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3), [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) |

## Assumptions, dependencies, trust boundaries, and limits

- `sendTransaction` waits for the chain; the caller passes no timeout.

## Specification adherence

- Signing on the host only ({{REQ:[`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)}}).
- Canonical serialized transaction shapes cross ({{REQ:[`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                   | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-ID-3-KR0BE3`](../../../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)     | Covered               | **Here:** every method ends on `host.chainSigner`.                                                                                                                         | None.            |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** `deserializeTransactionRequest` / `serializeTransactionResponse`. **Other files:** [../../chainSignerSerialization.ts.md](../../chainSignerSerialization.ts.md). | None.            |

## Related source reports

- [ChainSignerService.ts.md](./ChainSignerService.ts.md)
- [../../../signer/ClientChainSigner.ts.md](../../../signer/ClientChainSigner.ts.md) — the caller.
