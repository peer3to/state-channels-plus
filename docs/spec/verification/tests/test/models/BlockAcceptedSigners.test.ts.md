# BlockAcceptedSigners.test.ts

Test file: [test/models/BlockAcceptedSigners.test.ts](../../../../../../test/models/BlockAcceptedSigners.test.ts)

## Overview

Checks accepted signer addresses and logging metadata against real block signatures, including rejected extra signatures.

## Tests

- `a high-s confirmation is skipped: the author and the other confirmer remain, allSignerAddresses still throws`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P25
- `a confirmation with a v the contracts reject is skipped: only accepted signers remain, allSignerAddresses still throws`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P26
- `a rejected author signature is skipped: only the confirmers remain, allSignerAddresses still throws`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P27
- `an all-valid block → acceptedSignerAddresses equals allSignerAddresses`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P28
- `LoggerUtils.getBlockMetadata on a block with a rejected signature does not throw and lists only the accepted signers`: UNIT-TEST-BLOCK-MODEL-1-037DM6.P29
