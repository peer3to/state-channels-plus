# E2E-OmittedInboundJoiner.test.ts

Test file: [test/e2e/disputeValidation/E2E-OmittedInboundJoiner.test.ts](../../../../../../../test/e2e/disputeValidation/E2E-OmittedInboundJoiner.test.ts)

## Overview

Challenges a hop that consumes a join without the joiner signature. The pending auditor lacks predecessor holdings; the tests check the applied step counter and submitter slash.

## Tests

- `E38, E44: Charlie, pending without the hop's predecessor state, kills the posted-data dispute that consumes his join without him through the invalid-state-proof counter pointed at that hop`: REQ-FP-7-4DD0D7.T7.P18, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P93
- `E38: the same omitted-joiner hop as the second milestone, after the run holding the chain anchor → Charlie's invalid-state-proof counter points at milestone 1`: REQ-FP-7-4DD0D7.T7.P19, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P94
