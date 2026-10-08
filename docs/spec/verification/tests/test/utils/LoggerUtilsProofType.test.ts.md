# LoggerUtilsProofType.test.ts — Test report

> **Test file:** [test/utils/LoggerUtilsProofType.test.ts](../../../../../../test/utils/LoggerUtilsProofType.test.ts) > **Status:** Authored; engineer verification pending.

## Overview

Checks that each proof metadata lookup uses its own enum names and that unknown numeric values produce UNKNOWN(n).

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                  | Covers                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`LoggerUtils proof-type names > getDisputeFraudProofMeta names the DisputeFraudProofType key, never the FraudProofType key with the same small number`](../../../../../../test/utils/LoggerUtilsProofType.test.ts#L12) (line 12) | [`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P4`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-32-wmbbza) |
| [`LoggerUtils proof-type names > getFraudProofMetadata names the FraudProofType key for each small number`](../../../../../../test/utils/LoggerUtilsProofType.test.ts#L32) (line 32)                                              | [`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P5`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-32-wmbbza) |
| [`LoggerUtils proof-type names > an unknown proof type gives UNKNOWN(n) in both lookups`](../../../../../../test/utils/LoggerUtilsProofType.test.ts#L46) (line 46)                                                                | [`UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P6`](../../../../implementation/source/src/utils/LoggerUtils.ts.md#unit-test-logger-utils-32-wmbbza) |
