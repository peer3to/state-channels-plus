# AgreementManagerBuildFallback.test.ts

Test file: [test/unit/AgreementManagerBuildFallback.test.ts](../../../../../../test/unit/AgreementManagerBuildFallback.test.ts)

## Overview

Exercises proof construction when local evidence cannot advance the finalized target and checks the preflight walk of the built proof through the public manager boundary. The preflight is one chain walk from the proof's start; the proof consumes an inbound block in the first case and the chain's view precedes it in the second, and no second walk runs in either.

## Tests

- `the chain rejects the built proof (it answers from before the consumed inbound block) → buildStateProof throws, no proof, no second walk`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P57, REQ-SP-8-9ZCCEJ.T2.P21, REQ-MIRROR-6-0WSB4V.T1.P24
- `a consumed inbound block → the chain's one trusted-start walk accepts the built proof, the proof is returned, no second walk runs`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P56, REQ-SP-8-9ZCCEJ.T2.P20
