# src/evm/p2pRuntime/browser — Subsystem

> **Status:** Authored — engineer verification pending.

## Responsibility

The browser runtime owns the structured-clone channel between the SDK-facing browser context and the P2P worker runtime. It carries serializable signer requests and results while the main browser context owns WebRTC bridge installation.

## Key design decisions

- Worker messages stay serializable across real browser workers.
- Existing-channel observer connection and targeted auto-open membership use the same public signer contract as other runtime modes.
- WebRTC upgrade is observed through real browser traffic rather than inferred from setup state.

## Source inventory

- [P2pRuntimeChannel.ts](./P2pRuntimeChannel.ts.md)
- [P2pRuntimeWorkerRuntime.ts](./P2pRuntimeWorkerRuntime.ts.md)

## Integration test obligations

| Integration test ID | Obligation | Setup | Oracle | Required permutations |
| --- | --- | --- | --- | --- |
| <a id="integration-test-browser-p2p-runtime-1-e8w0m2"></a>`INTEGRATION-TEST-BROWSER-P2P-RUNTIME-1-E8W0M2` | Browser worker signer results and WebRTC traffic | Run the browser package script against a real chain, discovery relay, Vite host, main-thread SDK path, and app-worker SDK path | Existing-channel connect returns `true` at `SYNCED`; targeted auto-open and join returns `true` at pending or participating; upgraded traffic succeeds | <a id="integration-test-browser-p2p-runtime-1-e8w0m2.p1"></a>`INTEGRATION-TEST-BROWSER-P2P-RUNTIME-1-E8W0M2.P1` — the complete browser package-script flow reports both Boolean/status boundaries and successful upgraded traffic |
