# inboundAnchorAvailability.test.ts

Test file: [test/e2e/disputeValidation/inboundAnchorAvailability.test.ts](../../../../../../../test/e2e/disputeValidation/inboundAnchorAvailability.test.ts)

## Overview

The suite verifies both sources used by the moved inbound-anchor check. A posted dispute uses its
verified snapshot and creates `DisputeInboundAnchorBehindLatestState` when the claimed anchor is
behind it. A non-posted dispute whose pinned snapshot is missing locally causes the auditor to
abstain without storing a false proof.

## Tests

- `a posted snapshot with a behind inbound anchor creates the matching fraud proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-2-7H4K2D.P1, REQ-DISPUTE-PIPE-5-RZZB48.T2.P1
- `a non-posted dispute with no local pinned snapshot → the audit throws, no false inbound-anchor fraud proof`: none
