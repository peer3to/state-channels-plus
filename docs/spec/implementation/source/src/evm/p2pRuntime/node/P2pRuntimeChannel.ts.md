# P2pRuntimeChannel.ts — Source Report

> **Source:** [src/evm/p2pRuntime/node/P2pRuntimeChannel.ts](../../../../../../../../src/evm/p2pRuntime/node/P2pRuntimeChannel.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Node paired-channel implementation (worker_threads MessagePort): `adaptPort` for either end and
`adaptWorkerScope` for a worker entry serving the thread above it.

## Linked requirements

| Source file                                                                                  | Specification IDs                                                                                   |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [P2pRuntimeChannel.ts](../../../../../../../../src/evm/p2pRuntime/node/P2pRuntimeChannel.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

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
