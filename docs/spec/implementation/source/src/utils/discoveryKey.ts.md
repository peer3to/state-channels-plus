# discoveryKey.ts — Source Report

> **Source:** [src/utils/discoveryKey.ts](../../../../../../src/utils/discoveryKey.ts)  
> **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../views/architecture/sdk/components.md)

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

Names and derives the discovery key. `DiscoveryKey` is the type of a normalized 32-byte hex key a
runtime observes for peer discovery; `channelIdToDiscoveryKey` converts a channel's canonical bytes32
ID into one. The key is the exact 32 channel-ID bytes, not a UTF-8 rendering, repeated string, hash,
or truncated prefix.

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
4. **`DiscoveryKey` is a named alias, not a bare `string`** ([#L4](../../../../../../src/utils/discoveryKey.ts#L4)).
   Discovery membership is held in a collection keyed by these values
   ([`REQ-UPG-7-KQPXRE`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre)),
   and a plain `string` member carries no domain meaning at that use site. The alias lives with the
   derivation so the type and the only function that produces a channel key stay together, and both
   lobby topics and channel keys flow through it.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                          |
| ------------ | ----------------------------------------------------------------- |
| Inputs       | One hex-encoded bytes32 channel ID.                               |
| Outputs      | A `DiscoveryKey` — the normalized hex encoding of the same bytes. |
| Owned state  | None.                                                             |
| Side effects | None. Invalid input throws.                                       |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files. This utility supports the
channel side of `P2PManager`'s shared discovery-key boundary and names the membership value type. It
does not own lobby topic selection, matching semantics, or membership bookkeeping.

| Source file                                                    | Specification IDs                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [discoveryKey.ts](../../../../../../src/utils/discoveryKey.ts) | [`REQ-UPG-6-BC60XD`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd), [`REQ-UPG-7-KQPXRE`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre) |

## Assumptions, dependencies, trust boundaries, and limits

requireBytes32 validates without normalization. Each derivation retains its own ethers.hexlify operation and the targeted hash retains the targeted-channel-join domain separator. The `DiscoveryKey` alias is a type-level name only: it enforces nothing at runtime, and normalization stays the responsibility of the join/leave primitive that stores the value.

## Specification adherence

The source contribution is limited to the linked requirements and operation described above; surrounding policy remains in the related owners. The supplied channel key bytes are preserved exactly before discovery join or leave.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                  | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                            | Gap / divergence                                                    |
| -------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`REQ-UPG-6-BC60XD`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-6-bc60xd) | Covered               | **Here:** exact channel bytes and targeted domain separation are preserved by the two derivation functions. **Other files:** [P2PManager.ts.md](../P2PManager.ts.md) owns discovery admission and dispatch.                                                                                                                                                                         | None for derivation.                                                |
| [`REQ-UPG-7-KQPXRE`](../../../../specification/peer-communication/transport-upgrade.md#req-upg-7-kqpxre) | Partial               | **Here:** the `DiscoveryKey` type the observed-membership set is built from ([#L4](../../../../../../src/utils/discoveryKey.ts#L4)). **Other files:** [P2PManager](../P2PManager.ts.md) owns the set and the leave-all operation; [EventHandler](../eventHandlers/EventHandler.ts.md) and [LocalP2pSigner](../evm/signer/LocalP2pSigner.ts.md) own the leave-before-close ordering. | This file holds no membership state and takes no ordering decision. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports. The membership
set built from `DiscoveryKey` is covered by
[`UNIT-TEST-P2P-MANAGER-2-HR5HCB.P4`](../P2PManager.ts.md#unit-test-p2p-manager-2-hr5hcb.p4); this
file's own family below covers the derivations and their validation.

| Unit test ID                                                                      | Obligation                     | Public entry and setup                                                                                                                                    | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-discovery-key-32-f0qwhx"></a>`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX` | Discovery bytes and validation | Derive raw and domain-separated keys with boundary hex inputs and compare exact bytes/errors; direct validator cases assert caller error and void return. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-discovery-key-32-f0qwhx.p1"></a>`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P1` — rejects short IDs in both discovery derivations; <a id="unit-test-discovery-key-32-f0qwhx.p2"></a>`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P2` — rejects long IDs in both discovery derivations; <a id="unit-test-discovery-key-32-f0qwhx.p3"></a>`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P3` — rejects malformed IDs in both discovery derivations; <a id="unit-test-discovery-key-32-f0qwhx.p4"></a>`UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P4` — preserves mixed-case channel bytes and targeted derivation |

## Related source reports

- [P2PManager](../P2PManager.ts.md), [LocalP2pSigner](../evm/signer/LocalP2pSigner.ts.md).
