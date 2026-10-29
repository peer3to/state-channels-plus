# WebRTCWorkerBridgeRoot.ts

> **Source:** [src/rpc/internal/roots/WebRTCWorkerBridgeRoot.ts](../../../../../../../../src/rpc/internal/roots/WebRTCWorkerBridgeRoot.ts)

## Requirements

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-BRIDGE-ROOT-1-K5XX3Y

Forwarded broker attachment outside readiness

- Setup: Real production roots and their public operations.
- Oracle: Forwarded broker attachment outside readiness; no duplicate completion or leaked ownership.

- [x] `UNIT-TEST-BRIDGE-ROOT-1-K5XX3Y.P1` — Bridge forwarding becomes ready without a broker; queued negotiation resumes after actual broker attachment, and disposal reaches that child
- [x] `UNIT-TEST-BRIDGE-ROOT-1-K5XX3Y.P2` — Disposal before broker attachment closes the waiting child and rejects queued negotiation without another failure report; host remains usable
