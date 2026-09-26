# src/stateManager/validationStrategy — Subsystem

> **Status:** Skeleton — subsystem responsibility, design, assumptions, interactions, and
> integration obligations pending authoring.

_Pending authoring: shared responsibility, design decisions, assumptions, cross-file interactions, and integration obligations of this subsystem._

## Contents

- [AValidationStrategy.ts](./AValidationStrategy.ts.md)
- [BlockValidationStrategy.ts](./BlockValidationStrategy.ts.md)
- [CalldataCommittedStrategy.ts](./CalldataCommittedStrategy.ts.md)
- [DisputeValidationStrategy.ts](./DisputeValidationStrategy.ts.md)
- [SpectatingValidationStrategy.ts](./SpectatingValidationStrategy.ts.md)

## Queue admission contributions

| Source report | Contribution | Requirements |
| --- | --- | --- |
| [AValidationStrategy.ts](AValidationStrategy.ts.md) | The strategy contract includes unrecoverable confirmation values as an explicit deviation. | [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7) |
| [BlockValidationStrategy.ts](BlockValidationStrategy.ts.md) | Unrecoverable confirmations are stripped and their actual recorded suppliers are disconnected through the queue owner; no recovered signer is invented and the author is not blamed for sourceless confirmation junk. | [`REQ-GOSSIP-3-HQZNQX`](../../../../../specification/peer-communication/block-gossip.md#req-gossip-3-hqznqx) |
| [SpectatingValidationStrategy.ts](SpectatingValidationStrategy.ts.md) | Spectators persist accepted late confirmations and return SUCCESS without gossip. | [`REQ-GOSSIP-3-HQZNQX`](../../../../../specification/peer-communication/block-gossip.md#req-gossip-3-hqznqx) |
| [DisputeValidationStrategy.ts](DisputeValidationStrategy.ts.md) | Sourceless historical replay strips irrelevant unrecoverable confirmations and continues the objective pipeline. | [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7) |
| [CalldataCommittedStrategy.ts](CalldataCommittedStrategy.ts.md) | Observed calldata constructs a confirmation-free entry. | [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7) |
