# resolveCustomRpcManifest.ts

> **Source:** [src/rpc/network/resolveCustomRpcManifest.ts](../../../../../../../src/rpc/network/resolveCustomRpcManifest.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-RESOLVE-CUSTOM-RPC-1-TQ6BP6

Manifest resolution

- Setup: Resolve default/named/missing/non-function exports and no manifest
- Oracle: Constructors returned with options; non-function throws; no manifest → undefined

- [x] `UNIT-TEST-RESOLVE-CUSTOM-RPC-1-TQ6BP6.P1` — default export
- [ ] `UNIT-TEST-RESOLVE-CUSTOM-RPC-1-TQ6BP6.P2` — named export
- [ ] `UNIT-TEST-RESOLVE-CUSTOM-RPC-1-TQ6BP6.P3` — non-function throws
- [ ] `UNIT-TEST-RESOLVE-CUSTOM-RPC-1-TQ6BP6.P4` — absent manifest
