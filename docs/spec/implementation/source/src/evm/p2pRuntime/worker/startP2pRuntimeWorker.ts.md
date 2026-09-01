# startP2pRuntimeWorker.ts — Source Report

> **Source:** [src/evm/p2pRuntime/worker/startP2pRuntimeWorker.ts](../../../../../../../../src/evm/p2pRuntime/worker/startP2pRuntimeWorker.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Main-thread worker launcher: posts the bootstrap message with the runtime port and the bridge port
transferred; readiness is the `deployComplete` reply, not a handshake of this file's.

## Linked requirements

| Source file                                                                                            | Specification IDs                                                                                   |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [startP2pRuntimeWorker.ts](../../../../../../../../src/evm/p2pRuntime/worker/startP2pRuntimeWorker.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Port-protocol semantics identical across platforms.

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [P2pRuntimeHost](../P2pRuntimeHost.ts.md).
