# src/rpc/network/guards — Subsystem

> **Status:** Skeleton — subsystem responsibility, design, assumptions, interactions, and
> integration obligations pending authoring.

_Pending authoring: shared responsibility, design decisions, assumptions, cross-file interactions, and integration obligations of this subsystem._

## Contents

- [AGuard.ts](./AGuard.ts.md)
- [DeferredAdmissionGuard.ts](./DeferredAdmissionGuard.ts.md)
- [HandshakeCompletedGuard.ts](./HandshakeCompletedGuard.ts.md)
- [index.ts](./index.ts.md)
- [runGuards.ts](./runGuards.ts.md)

## Source inventory

| Source | Report |
| --- | --- |
| [AGuard.ts](../../../../../../../../src/rpc/network/guards/AGuard.ts) | [AGuard.ts.md](./AGuard.ts.md) |
| [DeferredAdmissionGuard.ts](../../../../../../../../src/rpc/network/guards/DeferredAdmissionGuard.ts) | [DeferredAdmissionGuard.ts.md](./DeferredAdmissionGuard.ts.md) |
| [HandshakeCompletedGuard.ts](../../../../../../../../src/rpc/network/guards/HandshakeCompletedGuard.ts) | [HandshakeCompletedGuard.ts.md](./HandshakeCompletedGuard.ts.md) |
| [index.ts](../../../../../../../../src/rpc/network/guards/index.ts) | [index.ts.md](./index.ts.md) |
| [runGuards.ts](../../../../../../../../src/rpc/network/guards/runGuards.ts) | [runGuards.ts.md](./runGuards.ts.md) |

## Removed declaration or barrel

The removed `src/rpc/guards/index.ts` only re-exported network guards. Their concrete source reports in this directory retain guard behavior; callers import those owners directly.
