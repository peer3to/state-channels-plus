# BlockUtils.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol)

## Requirements

- [`REQ-SP-7-70EMAT` (In the retained region, verification checks consecutive heights, hash links,…)](../../../../../../specification/disputes/state-proofs.md#req-sp-7-70emat)
  Partial: `_tryDecodeBlock` cannot judge a block whose decode budget plus the rest of the check exceeds the per-transaction gas cap ([`FIND-DECODE-2-CZ3FE5`](../../../../../../audit/open-findings.md#find-decode-2-cz3fe5)).
