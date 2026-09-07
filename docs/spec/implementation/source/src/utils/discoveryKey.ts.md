# discoveryKey.ts — Source Report

> **Source:** [src/utils/discoveryKey.ts](../../../../../../src/utils/discoveryKey.ts)  
> **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Converts a channel's canonical bytes32 ID into the transport discovery key. The key is the exact
32 channel-ID bytes, not a UTF-8 rendering, repeated string, hash, or truncated prefix.

### Targeted topic

`channelIdToTargetedJoinTopic` validates the same bytes32 input and returns the domain-separated packed hash
of `"targeted-channel-join"` and the channel ID. The raw `channelIdToDiscoveryKey` remains unchanged and is
used only after authoritative opening.

Shared operation owners: [bytes32.ts.md](bytes32.ts.md).

## Key design decisions

Raw discovery and targeted-topic derivation share validation from bytes32.ts. Hex normalization stays in these derivation functions; targeted topics retain their domain-separated hash. See [discoveryKey.ts](../../../../../../src/utils/discoveryKey.ts#L1).

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

## Assumptions, dependencies, trust boundaries, and limits

requireBytes32 validates without normalization. Each derivation retains its own ethers.hexlify operation and the targeted hash retains the targeted-channel-join domain separator.

## Specification adherence

The source contribution is limited to the linked requirements and operation described above; surrounding policy remains in the related owners.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                  | Implementation status | Evidence                                                                                                                                                                                                    | Gap / divergence     |
| -------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| [`REQ-UPG-6-BC60XD`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd) | Covered               | **Here:** exact channel bytes and targeted domain separation are preserved by the two derivation functions. **Other files:** [P2PManager.ts.md](../P2PManager.ts.md) owns discovery admission and dispatch. | None for derivation. |

## Component test obligations

| Unit test ID                                                                      | Obligation                     | Public entry and setup                                                                                                                                    | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-discovery-key-32-f0qwhx"></a>`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX` | Discovery bytes and validation | Derive raw and domain-separated keys with boundary hex inputs and compare exact bytes/errors; direct validator cases assert caller error and void return. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-discovery-key-32-f0qwhx.p1"></a>`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P1` — rejects short IDs in both discovery derivations; <a id="unit-test-discovery-key-32-f0qwhx.p2"></a>`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P2` — rejects long IDs in both discovery derivations; <a id="unit-test-discovery-key-32-f0qwhx.p3"></a>`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P3` — rejects malformed IDs in both discovery derivations; <a id="unit-test-discovery-key-32-f0qwhx.p4"></a>`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P4` — preserves mixed-case channel bytes and targeted derivation |

## Related source reports

- [P2PManager](../P2PManager.ts.md), [LocalP2pSigner](../evm/signer/LocalP2pSigner.ts.md).
