# StateChannelManagerStorage.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol)

## Requirements

- [`INV-CONTRACT-ARCH-1-TWQHTM` (Single logical state)](../../../../../specification/enforcement/contracts.md#inv-contract-arch-1-twqhtm)
- [`REQ-LIF-13-0MH9JW` (A clean close leaves no channel state)](../../../../../specification/settlement/lifecycle.md#req-lif-13-0mh9jw)

## UNIT-TEST-MANAGER-STORAGE-1-ET3GPF

Layout stability

- Setup: Compile-time layout snapshot comparison
- Oracle: Layout matches the committed reference; changes are deliberate migrations

- [ ] `UNIT-TEST-MANAGER-STORAGE-1-ET3GPF.P1` — storage-layout diff gate
