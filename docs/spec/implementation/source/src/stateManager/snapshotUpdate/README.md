# src/stateManager/snapshotUpdate — Subsystem

> **Status:** Skeleton — subsystem responsibility, design, assumptions, interactions, and
> integration obligations pending authoring.

_Pending authoring: shared responsibility, design decisions, assumptions, cross-file interactions, and integration obligations of this subsystem._

## Contents

- [StateApplicationService.ts](./StateApplicationService.ts.md)
- [SnapshotUpdateService.ts](./SnapshotUpdateService.ts.md)
- [index.ts](./index.ts.md)

## Queue admission contributions

| Source report | Contribution | Requirements |
| --- | --- | --- |
| [StateApplicationService.ts](StateApplicationService.ts.md) | General snapshot adoption saves the previous VM state, installs the candidate, and performs participant/status/next-author reads before publishing storage, fork and eligibility. | [`REQ-GOSSIP-4-J5Z4DF`](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df) |
