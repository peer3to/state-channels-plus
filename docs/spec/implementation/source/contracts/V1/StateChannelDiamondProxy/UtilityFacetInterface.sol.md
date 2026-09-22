# UtilityFacetInterface.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/UtilityFacetInterface.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacetInterface.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Requirements

- [`REQ-CONTRACT-ARCH-4-FZ3CJE` (Upgrade and deployment integrity)](../../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje)
  Partial: Compile-time only: nothing checks that the **deployed** `utilityFacetAddress` implements this type (deployer-trusted, see assumptions).
- [`INV-ENFPROOF-1-DR1N9B` (Side-effect-free verification)](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b)
