# index.ts

> **Source:** [src/cache/index.ts](../../../../../../src/cache/index.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [protocol/finality.md](../../../views/protocol/finality.md)

No specified behavior: The `@/cache` module barrel: re-exports everything from SignerRecoveryCache and EcrecoverCache (#L1, #L2), including their test-only reset and size helpers.
