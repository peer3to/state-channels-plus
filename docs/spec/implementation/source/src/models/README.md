# src/models — Subsystem

> **Status:** Skeleton — subsystem responsibility, design, assumptions, interactions, and
> integration obligations pending authoring.

_Pending authoring: shared responsibility, design decisions, assumptions, cross-file interactions, and integration obligations of this subsystem._

## Contents

- [Block.ts](./Block.ts.md)
- [StateProof.ts](./StateProof.ts.md)
- [StateSnapshot.ts](./StateSnapshot.ts.md)
- [index.ts](./index.ts.md)

## Queue admission contributions

| Source report | Contribution | Requirements |
| --- | --- | --- |
| [Block.ts](Block.ts.md) | Constructors, author signing, expansion and removal share SignatureUtils byte normalization. | [`REQ-QSTORE-2-VYWJAQ`](../../../../specification/storage/queue.md#req-qstore-2-vywjaq) |
