# inboundAnchorAvailability.test.ts

Test file: [test/e2e/disputeValidation/inboundAnchorAvailability.test.ts](../../../../../../../test/e2e/disputeValidation/inboundAnchorAvailability.test.ts)

## Overview

The suite verifies both sources used by the moved inbound-anchor check. A posted dispute uses its
verified snapshot and creates `DisputeInboundAnchorBehindLatestState` when the claimed anchor is
behind it. A non-posted dispute whose pinned snapshot the auditor drops after its stored proof
advanced is judged from the final point the stored proof holds: the audit returns valid and stores
no false proof.

## Tests

- `a posted snapshot with a behind inbound anchor creates the matching fraud proof`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-2-7H4K2D.P1, REQ-DISPUTE-PIPE-5-RZZB48.T2.P1
- `a non-posted dispute whose snapshot the auditor drops after its stored proof advanced → the audit reads its final point from the stored proof, judges the dispute valid, no false inbound-anchor fraud proof`: none
