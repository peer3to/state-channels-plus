# ClientChainSigner.ts

> **Source:** [src/evm/signer/ClientChainSigner.ts](../../../../../../../src/evm/signer/ClientChainSigner.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/architecture.md](../../../../views/architecture/sdk/architecture.md)

## Requirements

- [`REQ-ID-3-KR0BE3` (Confined signing authority)](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)
- [`REQ-SDK-ARCH-5-AAM7YK` (Chain submissions survive concurrent inclusion)](../../../../../specification/runtime/sdk.md#req-sdk-arch-5-aam7yk)
- [`REQ-SDK-ARCH-6-8DE4ER` (Chain spending is observable)](../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er)
