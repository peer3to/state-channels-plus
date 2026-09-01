# noOpLogger.ts — Source Report

> **Source:** [noOpLogger.ts](../../../../../../../src/utils/logging/noOpLogger.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/components.md](../../../../views/architecture/sdk/components.md)

## Responsibility and observable boundary

A logger that keeps and writes nothing, for the moments a realm has no logger yet: the executor
factory without a caller-supplied logger, and a port router before its worker's config arrived.

## Linked requirements

| Source file                                                           | Specification IDs |
| --------------------------------------------------------------------- | ----------------- |
| [noOpLogger.ts](../../../../../../../src/utils/logging/noOpLogger.ts) |                   |

## Assumptions, dependencies, trust boundaries, and limits

- It is its own child and root, so it never joins a parent/child graph.

## Specification adherence

- Role-consistent with the owning views.

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Related source reports

- [Logger.ts.md](./Logger.ts.md) — the contract it satisfies.
- [../../rpc/PortRpcRouter.ts.md](../../rpc/PortRpcRouter.ts.md) — starts on it.
