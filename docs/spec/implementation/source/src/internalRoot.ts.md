# internalRoot.ts

> **Source:** [src/internalRoot.ts](../../../../../src/internalRoot.ts)

Package entry `@peer3/state-channels-plus/internal-root`: the internal root API alone, for a worker
that runs only its own services. It re-exports the same modules as the package index, so a root or
service class is the same class through either entry; it adds no behavior. Its static import graph
leaves out the runtime host root and its transports.

## Requirements

- [`REQ-RPC-9-8FFE6S` (Application host root)](../../../specification/peer-communication/rpc.md#req-rpc-9-8ffe6s)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
