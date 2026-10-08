# StateChannelManagerEvents.sol

> **Source:** [contracts/V1/StateChannelManagerEvents.sol](../../../../../../contracts/V1/StateChannelManagerEvents.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../views/architecture/contracts/manager-and-facets.md)

## Requirements

- [`REQ-IX-7-A004VZ` (Chain observation)](../../../../specification/interactions.md#req-ix-7-a004vz)
  Missing: `OutboundMessagesProcessed` is absent from the SDK's dispatched-event set, and its emit site in `StateSnapshotFacet` carries a source TODO ("this event is not used"). See [`DEF-2-SHQR0A`](../../../../audit/open-findings.md#def-2-shqr0a).
