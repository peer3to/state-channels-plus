# MainRpcService.ts

> **Source:** [src/rpc/network/MainRpcService.ts](../../../../../../../src/rpc/network/MainRpcService.ts)

## Requirements

- [`REQ-RPC-9-8FFE6S` (Application host root)](../../../../../specification/peer-communication/rpc.md#req-rpc-9-8ffe6s)
- [`INV-RPC-1-SJS2T6` (Identity-bound dispatch)](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)
- [`REQ-RPC-3-ZM9WR5` (Service authorization)](../../../../../specification/peer-communication/rpc.md#req-rpc-3-zm9wr5)

## UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M

Roster and readiness for [`INV-RPC-1-SJS2T6` (Identity-bound dispatch)](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6) and [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

- Setup: Construct; enumerate services; await ready
- Oracle: Base ready resolves; custom ready gates admission

- [ ] `UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P1` — roster exact
- [ ] `UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P2` — unknown service unreachable
- [ ] `UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P3` — custom-root extension
- [x] `UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P5` — delayed custom readiness in inline mode
- [x] `UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P6` — rejected custom readiness in inline mode
- [x] `UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P7` — delayed custom readiness in worker mode
- [x] `UNIT-TEST-MAIN-RPC-SERVICE-1-AWN39M.P8` — rejected custom readiness in worker mode
