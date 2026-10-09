# LoggerUtilsProofType.test.ts

Test file: [test/utils/LoggerUtilsProofType.test.ts](../../../../../../test/utils/LoggerUtilsProofType.test.ts)

## Overview

Checks that each proof metadata lookup uses its own enum names and that unknown numeric values produce UNKNOWN(n).

## Tests

- `getDisputeFraudProofMeta names the DisputeFraudProofType key, never the FraudProofType key with the same small number`: UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P4
- `getFraudProofMetadata names the FraudProofType key for each small number`: UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P5
- `an unknown proof type gives UNKNOWN(n) in both lookups`: UNIT-TEST-LOGGER-UTILS-32-WMBBZA.P6
