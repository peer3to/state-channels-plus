# DisconnectPolicy.ts

> **Source:** [src/DisconnectPolicy.ts](../../../../../src/DisconnectPolicy.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../views/architecture/sdk/rpc/README.md), [architecture/sdk/components.md](../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)
  Partial: The file decides nothing on its own; the stage-by-stage consequences live with the callers.
