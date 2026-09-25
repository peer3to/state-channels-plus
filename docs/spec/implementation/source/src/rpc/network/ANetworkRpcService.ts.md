# ANetworkRpcService.ts

> **Source:** [src/rpc/network/ANetworkRpcService.ts](../../../../../../../src/rpc/network/ANetworkRpcService.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`INV-RPC-1-SJS2T6` (Identity-bound dispatch)](../../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)
- [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)
  Partial: No cancellation API exists.
- [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)
- [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)
- [`REQ-TJOIN-4-SDPZJW` (Direct response routing)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-4-sdpzjw)

## UNIT-TEST-ARPC-SERVICE-1-S4T98Z

Dispatch-order tail and consequences

- Setup: Drive guarded/unguarded services over real trusted and untrusted transports with valid and invalid endpoint surfaces
- Oracle: Guards run first; only declared application endpoints execute once; request/one-way consequences keep their existing split

- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P1` — guard failure settles request
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P2` — trusted-flag guard bypass branch
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P3` — missing endpoint → false
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P4` — RPC-base and Object-base names reject
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P5` — handler throw on request
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P6` — network transport guards run
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P7` — handler rejection on fire-and-forget
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P8` — concrete class method
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P9` — inherited application endpoint
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P10` — function-valued own field
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P11` — accessor rejects without evaluation
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P12` — non-function rejects
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P13` — captured function invoked after property replacement
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P14` — same endpoint rule for request and one-way delivery
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P15` — Object-base stop when the local RPC base is absent
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P16` — existing and absent endpoint probes receive the same guard consequence before method construction
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P17` — real loopback guard bypass
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P18` — one-way guard failure has no response or method construction
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P19` — synchronous one-way throw
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P20` — captured function on one-way delivery
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P21` — unguarded service over untrusted transport
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P22` — params spread and methods-instance binding
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P23` — child accessor shadows inherited endpoint without evaluation
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P24` — child non-function shadows inherited endpoint
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P25` — empty request ID takes request path
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P26` — handler-response send fails once and disconnects without unhandled rejection
- [x] `UNIT-TEST-ARPC-SERVICE-1-S4T98Z.P27` — guard-response send fails once and disconnects without unhandled rejection
