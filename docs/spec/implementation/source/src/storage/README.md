# src/storage — Subsystem

> **Status:** Skeleton — subsystem responsibility, design, assumptions, interactions, and
> integration obligations pending authoring.

_Pending authoring: shared responsibility, design decisions, assumptions, cross-file interactions, and integration obligations of this subsystem._

## Contents

- [BlacklistStorage.ts](./BlacklistStorage.ts.md)
- [BlockCalldataStorage.ts](./BlockCalldataStorage.ts.md)
- [BlockStorage.ts](./BlockStorage.ts.md)
- [DisputeFraudProofStorage.ts](./DisputeFraudProofStorage.ts.md)
- [DisputeStorage.ts](./DisputeStorage.ts.md)
- [EventSyncStorage.ts](./EventSyncStorage.ts.md)
- [ForceExitStorage.ts](./ForceExitStorage.ts.md)
- [ForceJoinStorage.ts](./ForceJoinStorage.ts.md)
- [FraudProofStorage.ts](./FraudProofStorage.ts.md)
- [MessageBlockStorage.ts](./MessageBlockStorage.ts.md)
- [ParticipantSetChangeStorage.ts](./ParticipantSetChangeStorage.ts.md)
- [QueueStorage.ts](./QueueStorage.ts.md)
- [StateMachineStateStorage.ts](./StateMachineStateStorage.ts.md)
- [StateSnapshotStorage.ts](./StateSnapshotStorage.ts.md)
- [Storage.ts](./Storage.ts.md)
- [TimeoutStorage.ts](./TimeoutStorage.ts.md)
- [index.ts](./index.ts.md)
- [keys.ts](./keys.ts.md)

## Queue admission contributions

| Source report | Contribution | Requirements |
| --- | --- | --- |
| [QueueStorage.ts](QueueStorage.ts.md) | One canonical source-to-signatures map records spent contributions. | [`REQ-QSTORE-2-VYWJAQ`](../../../../specification/storage/queue.md#req-qstore-2-vywjaq) |
| [Storage.ts](Storage.ts.md) | The storage facade passes the deployed N to QueueStorage and keeps deep-copy boundaries. | [`REQ-GOSSIP-4-J5Z4DF`](../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df) |
