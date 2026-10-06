# BlockAcceptedSigners.test.ts — Test report

> **Test file:** [test/models/BlockAcceptedSigners.test.ts](../../../../../../test/models/BlockAcceptedSigners.test.ts) > **Status:** Authored; engineer verification pending.

## Overview

Checks accepted signer addresses and logging metadata against real block signatures, including rejected extra signatures.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                              | Covers                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`Block accepted signers > a high-s confirmation is skipped: the author and the other confirmer remain, allSignerAddresses still throws`](../../../../../../test/models/BlockAcceptedSigners.test.ts#L19) (line 19)           | [`UNIT-TEST-BLOCK-MODEL-1-037DM6.P25`](../../../../implementation/source/src/models/Block.ts.md#unit-test-block-model-1-037dm6.p25) |
| [`Block accepted signers > a confirmation with a v the contracts reject is skipped: only accepted signers remain, allSignerAddresses still throws`](../../../../../../test/models/BlockAcceptedSigners.test.ts#L36) (line 36) | [`UNIT-TEST-BLOCK-MODEL-1-037DM6.P26`](../../../../implementation/source/src/models/Block.ts.md#unit-test-block-model-1-037dm6.p26) |
| [`Block accepted signers > a rejected author signature is skipped: only the confirmers remain, allSignerAddresses still throws`](../../../../../../test/models/BlockAcceptedSigners.test.ts#L53) (line 53)                    | [`UNIT-TEST-BLOCK-MODEL-1-037DM6.P27`](../../../../implementation/source/src/models/Block.ts.md#unit-test-block-model-1-037dm6.p27) |
| [`Block accepted signers > an all-valid block → acceptedSignerAddresses equals allSignerAddresses`](../../../../../../test/models/BlockAcceptedSigners.test.ts#L75) (line 75)                                                 | [`UNIT-TEST-BLOCK-MODEL-1-037DM6.P28`](../../../../implementation/source/src/models/Block.ts.md#unit-test-block-model-1-037dm6.p28) |
| [`Block accepted signers > LoggerUtils.getBlockMetadata on a block with a rejected signature does not throw and lists only the accepted signers`](../../../../../../test/models/BlockAcceptedSigners.test.ts#L89) (line 89)   | [`UNIT-TEST-BLOCK-MODEL-1-037DM6.P29`](../../../../implementation/source/src/models/Block.ts.md#unit-test-block-model-1-037dm6.p29) |
