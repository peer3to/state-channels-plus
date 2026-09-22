# StateChannelManagerStorage.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Requirements

- [`INV-CONTRACT-ARCH-1-TWQHTM` (Single logical state)](../../../../../specification/enforcement/contracts.md#inv-contract-arch-1-twqhtm)
- [`REQ-LIF-8-2HDG3A` (Enumerable open-channel lifecycle)](../../../../../specification/settlement/lifecycle.md#req-lif-8-2hdg3a)

## UNIT-TEST-MANAGER-STORAGE-1-ET3GPF

Layout stability

- Setup: Compile-time layout snapshot comparison
- Oracle: Layout matches the committed reference; changes are deliberate migrations

- [ ] `UNIT-TEST-MANAGER-STORAGE-1-ET3GPF.P1` — storage-layout diff gate
