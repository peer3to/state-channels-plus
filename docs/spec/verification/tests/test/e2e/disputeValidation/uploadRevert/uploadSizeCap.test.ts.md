# uploadSizeCap.test.ts

Test file: [test/e2e/disputeValidation/uploadRevert/uploadSizeCap.test.ts](../../../../../../../../test/e2e/disputeValidation/uploadRevert/uploadSizeCap.test.ts)

## Overview

Deploys the manager with its dispute upload cap set to the encoded size of a three-peer
self-removal dispute after blocks 0..1, measured on this staging (2,144 bytes). The leaver's
dispute is posted through `selfRemoveViaDisputeWait` with the other peers' idle-writer timeouts
and the leaver's own re-upload suppressed. The test checks that exactly one dispute is committed
and that its encoded size equals the cap the chain reports, then that no kill event fires for
4 seconds, nobody is slashed on chain, and the reduction leaves a two-party fork.

## Tests

- `an honest self-removal dispute whose encoded size equals the deployed upload cap → the chain commits it, no kill, no slash, the leaver leaves the reduced fork`: REQ-DIS-2-PKVZ7E.T1.P35
