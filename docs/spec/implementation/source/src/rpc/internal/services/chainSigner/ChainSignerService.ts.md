# ChainSignerService.ts

> **Source:** [src/rpc/internal/services/chainSigner/ChainSignerService.ts](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts)
>
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-SDK-ARCH-6-8DE4ER` (Chain spending is observable)](../../../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er)
