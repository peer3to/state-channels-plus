# TransportType.ts — Source Report

> **Source:** [src/transport/TransportType.ts](../../../../../../src/transport/TransportType.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Responsibility and observable boundary

The transport-type enum (preference negotiation vocabulary), plus `MESSAGE_PORT` for a worker link,
which is never negotiated.

## Linked requirements

| Source file                                                          | Specification IDs |
| -------------------------------------------------------------------- | ----------------- |
| [TransportType.ts](../../../../../../src/transport/TransportType.ts) |                   |

## Assumptions, dependencies, trust boundaries, and limits

- Network transports are untrusted byte pipes; identity comes only from the handshake.

## Specification adherence

- Role-consistent with the transport/handshake views.

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [InitHandshakeService](../rpc/services/initHandshake/InitHandshakeService.ts.md).
