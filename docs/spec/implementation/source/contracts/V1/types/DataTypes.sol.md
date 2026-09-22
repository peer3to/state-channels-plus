# DataTypes.sol

> **Source:** [contracts/V1/types/DataTypes.sol](../../../../../../../contracts/V1/types/DataTypes.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md)

## Requirements

- [`REQ-DATA-1-1KNRQS` (Decoders reject malformed, truncated, trailing, out-of-range, wrong-tag, and…)](../../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs)
- [`INV-HIST-1-5N44K9` (Block commits to the state snapshot hash)](../../../../../specification/protocol-model/history-and-commitments.md#inv-hist-1-5n44k9)
- [`INV-HIST-3-T17T78` (Snapshots commit to inbound and outbound message-stream tips)](../../../../../specification/protocol-model/history-and-commitments.md#inv-hist-3-t17t78)
- [`REQ-MSG-1-AY3A77` (Snapshots MUST commit both stream tips + totals)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-1-ay3a77)
- [`REQ-DATA-2-A5HMZP` (Field and collection ordering, duplicate policy, optionality, and nested-byte…)](../../../../../specification/protocol-model/data-types.md#req-data-2-a5hmzp)
