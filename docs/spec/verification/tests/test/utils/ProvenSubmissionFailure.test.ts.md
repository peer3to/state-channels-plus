# ProvenSubmissionFailure.test.ts

Test file: [test/utils/ProvenSubmissionFailure.test.ts](../../../../../../test/utils/ProvenSubmissionFailure.test.ts)
Exercises: [evmErrorHandler.ts](../../../../implementation/source/src/utils/evmErrorHandler.ts.md)

## Overview

Each case makes a founder's real submission fail on the test chain and classifies the caught error with
`tryDecodeCustomError` and `isProvenSubmissionFailure`. A block posted by another author than the sender
is refused with the decoded `ErrorBlockCalldataMsgSenderNotBlockAuthor`; the same post sent with gas for
little more than its calldata is mined and runs out of gas, so its receipt has status 0 and no reason
decodes. A transfer of more value than the account holds fails before it is mined, and a value call to
the proxy fallback reverts with no data and no receipt; neither is a proven failure.

## Tests

- `a submission the chain refuses with a decoded custom error is a proven failure`: UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P38
- `a mined submission whose receipt failed is a proven failure, with no decoded reason`: UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P39
- `a submission that fails with no receipt and no decoded revert is not a proven failure`: UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P40
- `a reverted call with no receipt and no revert data is not a proven failure`: UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P41
