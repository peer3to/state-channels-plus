# ConnectToChannelOptions.ts — Source Report

> **Source:** [src/evm/signer/ConnectToChannelOptions.ts](../../../../../../../src/evm/signer/ConnectToChannelOptions.ts) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Defines the public serializable option record for one fixed-target connect operation: independent
`autoOpen`, `shouldJoin`, full `balance`, and unmatched `timeoutMs`. It defines no peer policy or join
deadline. Balance is dormant unless joining is requested.

## Linked requirements

| Source file                                                                                  | Specification IDs                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ConnectToChannelOptions.ts](../../../../../../../src/evm/signer/ConnectToChannelOptions.ts) | [`REQ-TJOIN-1-5VGR1F`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f), [`INV-RUNTIME-1-AKRHAK`](../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) |

## Verification

The runtime-port signer-contract and input-validation cases cover serialization, independence, defaults,
invalid values, and Boolean propagation.
