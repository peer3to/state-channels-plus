# src/stateManager — Subsystem

> **Status:** Skeleton — subsystem responsibility, design, assumptions, interactions, and
> integration obligations pending authoring.

_Pending authoring: shared responsibility, design decisions, assumptions, cross-file interactions, and integration obligations of this subsystem._

## Contents

- [block/BlockCommitService.ts](./block/BlockCommitService.ts.md)
- [ingest/BlockQueueManager.ts](./ingest/BlockQueueManager.ts.md)
- [DisputeValidationService.ts](./dispute/DisputeValidationService.ts.md)
- [EventSyncService.ts](./eventSync/EventSyncService.ts.md)
- [StateManager.ts](./StateManager.ts.md)
- [ValidationService.ts](./ingest/ValidationService.ts.md)
- [index.ts](./index.ts.md)
- [membership/](./membership/README.md)
- [reduction/](./reduction/README.md)
- [snapshotUpdate/](./snapshotUpdate/README.md)
- [utils/](./utils/README.md)
- [validationStrategy/](./validationStrategy/README.md)

## Source inventory

| Source file | Responsibility |
| --- | --- |
| [chainFallback/ParticipantTimeoutService.ts](./chainFallback/ParticipantTimeoutService.ts.md) | Revalidate silent-writer deadlines and re-arm early chain-time refusals through the existing scheduler. |
| [chainFallback/CalldataPostingService.ts](./chainFallback/CalldataPostingService.ts.md) | Publish incompletely signed blocks and handle receipt recovery before collecting the operation. |
