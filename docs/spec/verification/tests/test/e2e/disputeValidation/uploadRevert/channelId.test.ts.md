# channelId.test.ts

Test file: [test/e2e/disputeValidation/uploadRevert/channelId.test.ts](../../../../../../../../test/e2e/disputeValidation/uploadRevert/channelId.test.ts)

## Overview

A single upload-gate case driven at the on-chain manager boundary: after `preDisputeSetup`,
`postTamperedDispute` randomizes `dispute.input.channelId` and the harness asserts the upload
transaction reverts with the decoded custom error `ErrorCantParticipateInDispute` — the
sender is not an eligible participant of the claimed channel, so no dispute window is
created; the revert's arguments carry the claimed channel id and the ineligible sender, so
the rejection is checked against the values the caller actually supplied. Audit-side behavior
is out of scope; the tampered dispute never reaches the
state-proof checks. After the permutation atomization the case carries the per-gate
cannot-participate revert, the ineligible-uploader rejection (now split from the slashed
uploader), and the wrong-channel intake rejection.

## Tests

- `dispute.input.channelId = random → dispute upload fails → ErrorCantParticipateInDispute`: UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P9, REQ-ENFDIS-2-VV9FPR.T1.P4, REQ-DISPUTE-PIPE-1-HRBFP7.T1.P5
