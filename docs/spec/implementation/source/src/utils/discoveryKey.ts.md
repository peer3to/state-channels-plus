# discoveryKey.ts — Source Report

> **Source:** [src/utils/discoveryKey.ts](../../../../../../src/utils/discoveryKey.ts)  
> **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Converts a channel's canonical bytes32 ID into the transport discovery key. The key is the exact
32 channel-ID bytes, not a UTF-8 rendering, repeated string, hash, or truncated prefix.

## Key design decisions

1. The helper is transport-independent and lives in shared utilities instead of `P2PManager`.
2. Non-hex and non-bytes32 inputs reject before any discovery backend is called.
3. The output preserves all channel-ID bits, so two IDs cannot share a key merely because their text prefixes match.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                          |
| ------------ | ------------------------------------------------- |
| Inputs       | One hex-encoded bytes32 channel ID.               |
| Outputs      | The normalized hex encoding of the same 32 bytes. |
| Owned state  | None.                                             |
| Side effects | None. Invalid input throws.                       |

## Linked requirements

This utility supports the channel side of `P2PManager`'s shared discovery-key boundary. It does not
own lobby topic selection or matching semantics.

| Source file                                                    | Specification IDs                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [discoveryKey.ts](../../../../../../src/utils/discoveryKey.ts) | [`REQ-UPG-6-BC60XD`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd) |

The utility preserves the supplied channel key bytes before discovery join/leave. Exact bytes32
preservation and invalid-input rejection are covered by
[`UNIT-TEST-P2P-MANAGER-2-HR5HCB.P3`](../P2PManager.ts.md#unit-test-p2p-manager-2-hr5hcb.p3).

## Verification evidence

The focused discovery-key utility suite covers exact bytes32 preservation and invalid-input rejection.

## Related source reports

- [P2PManager](../P2PManager.ts.md), [LocalP2pSigner](../evm/signer/LocalP2pSigner.ts.md).

## Targeted topic

`channelIdToTargetedJoinTopic` validates the same bytes32 input and returns the domain-separated packed hash
of `"targeted-channel-join"` and the channel ID. The raw `channelIdToDiscoveryKey` remains unchanged and is
used only after authoritative opening.
