# NetworkTransport.ts

> **Source:** [src/transport/NetworkTransport.ts](../../../../../../src/transport/NetworkTransport.ts)
>
> **Design views:** [Runtime and concurrency](../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`INV-RPC-1-SJS2T6` (Identity-bound dispatch)](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)
- [`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)
- [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)
  Partial: This file contributes only its own close; it verifies no ingress stage.
- [`REQ-UPG-4-M2XDBA` (Fallback ban and explicit exclusion)](../../../../specification/peer-communication/transport-upgrade.md#req-upg-4-m2xdba)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- [`REQ-LOBBY-7-BXQ1QA` (Symmetric timeout consequence)](../../../../specification/peer-communication/lobby-matching.md#req-lobby-7-bxq1qa)

## UNIT-TEST-ATRANSPORT-1-7DGX9R

Identity, delivery, lifecycle, and runtime shape

- Setup: Drive a concrete transport inside a real peer runtime; compare authenticated identities and replacement transports; send calls and responses; close expected and unexpected connections; inspect cross-module shapes
- Oracle: Identities normalize without object identity; frames serialize exactly once; close effects occur once with correct event classification; synchronous failures propagate; only complete compatible shapes pass

- [x] `UNIT-TEST-ATRANSPORT-1-7DGX9R.P1` — same reference matches without identity, distinct unknown/partially known transports do not, case variants match, and different addresses do not
- [x] `UNIT-TEST-ATRANSPORT-1-7DGX9R.P2` — network transport is untrusted while loopback is trusted
- [x] `UNIT-TEST-ATRANSPORT-1-7DGX9R.P3` — `send` serializes the RPC once before concrete delivery
- [x] `UNIT-TEST-ATRANSPORT-1-7DGX9R.P4` — distinct transport types with the same authenticated address match across replacement
- [x] `UNIT-TEST-ATRANSPORT-1-7DGX9R.P5` — compatible transport public shape from another module graph is accepted
- [x] `UNIT-TEST-ATRANSPORT-1-7DGX9R.P6` — primitives, wrong property types, missing methods, and non-function methods are rejected
- [x] `UNIT-TEST-ATRANSPORT-1-7DGX9R.P7` — `sendRpcResponse` serializes the response once before concrete delivery
- [x] `UNIT-TEST-ATRANSPORT-1-7DGX9R.P8` — unexpected close marks closed, emits one disconnection event, removes once, and closes concretely once
- [x] `UNIT-TEST-ATRANSPORT-1-7DGX9R.P9` — expected close performs removal and concrete cleanup without an unexpected-disconnection event
- [x] `UNIT-TEST-ATRANSPORT-1-7DGX9R.P10` — repeated close has no additional effects
- [x] `UNIT-TEST-ATRANSPORT-1-7DGX9R.P11` — serialization and concrete-send errors propagate synchronously
- [x] `UNIT-TEST-ATRANSPORT-1-7DGX9R.P12` — A fresh network transport constructed through a separate module graph owns an explicit undefined peerAddress slot before authentication and passes structural network recognition

## UNIT-TEST-ATRANSPORT-32-QF87JK

Transport frame conversion

- Setup: Invoke the real network onMessage with string, Buffer and a throwing conversion; a record-only onRpc capture observes payload/receiver and the same conversion error escapes.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-ATRANSPORT-32-QF87JK.P1` — converts string and Buffer frames and preserves conversion errors
