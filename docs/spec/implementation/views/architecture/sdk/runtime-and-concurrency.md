# Runtime & Concurrency — Transport-Neutral Workers

> **Specification subject:** [Runtime Isolation and Concurrency](../../../../specification/runtime/execution.md)

## INTEGRATION-TEST-BROWSER-P2P-RUNTIME-1-E8W0M2

Browser worker signer results and WebRTC traffic

- Setup: Run the browser package script against a real chain, discovery relay, Vite host, main-thread SDK path, and app-worker SDK path
- Oracle: Existing-channel connect returns `true` at `SYNCED`; targeted auto-open and join returns `true` at pending or participating; upgraded traffic succeeds

- [x] `INTEGRATION-TEST-BROWSER-P2P-RUNTIME-1-E8W0M2.P1` — the complete browser package-script flow reports both Boolean/status boundaries and successful upgraded traffic

## INTEGRATION-TEST-RUNTIME-RPC-1-3J92X6

SDK parent/child connection controls across local and worker placement.

- Setup: Actual SDK-owned roots and connected domain services; narrow controls act on those connections.
- Oracle: The typed host control holds only the selected real executor reply, independent SDK calls complete, release settles the correct result and leaves no owned pending request.

- [x] `INTEGRATION-TEST-RUNTIME-RPC-1-3J92X6.P1` — Controls the actual executor connection through the host harness service
- [x] `INTEGRATION-TEST-RUNTIME-RPC-1-3J92X6.P2` — Controls an SDK worker's executor connection through the same harness service
