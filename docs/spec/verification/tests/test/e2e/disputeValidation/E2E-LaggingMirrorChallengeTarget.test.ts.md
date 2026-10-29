# E2E-LaggingMirrorChallengeTarget.test.ts

Test file: [test/e2e/disputeValidation/E2E-LaggingMirrorChallengeTarget.test.ts](../../../../../../../test/e2e/disputeValidation/E2E-LaggingMirrorChallengeTarget.test.ts)

## Overview

Audits with a lagging mirror and a newer chain anchor. Checks chain fallback, protected prefixes and original last-milestone indices for genuine tail faults.

## Tests

- `E33: an auditor whose mirror lags the chain anchor kills an eligible tail offense on chain at its position from the last milestone's start, the same position a current auditor stores; the lagging auditor is not slashed`: REQ-SP-9-RNXP56.T6.P11, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P86
- `E33 ext: anchor in the middle of the last milestone → the lagging and the current auditor both target the shifted position (index 3), the lagging auditor's kill lands, only the submitter is slashed`: REQ-SP-9-RNXP56.T6.P12, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P87
- `E33 ext: structure fault at the position following the boundary (index 3 after the anchor at index 2) → the lagging auditor's DisputeInvalidBlockStructure names index 3 and kills the dispute, only the submitter is slashed`: REQ-SP-9-RNXP56.T6.P13, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P88
- `E33 ext: forged block below the chain anchor (block 1, so the anchor at the boundary index no longer links) with an honest block after it → the lagging tiers fail, the chain tier replays from the anchor: no false accusation, no kill, the submitter is not slashed`: REQ-SP-9-RNXP56.T6.P14, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P89
- `E33 ext: forged block below the chain anchor plus a genuine invalid transition two blocks after the anchor → the transition counter from the chain anchor names that block (index 4), the lagging auditor's kill lands, only the submitter is slashed`: REQ-SP-9-RNXP56.T6.P15, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P90
- `E33 ext: defect between the mirror anchor (genesis) and the chain anchor (block 2) in a proof ending at the chain anchor → the local failure reaches the chain check, which protects it: no block-specific challenge, no kill`: REQ-SP-9-RNXP56.T6.P16, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P91
- `E33 ext: the same defect below the chain anchor plus an invalid transition right after the chain cutoff (control) → escalates on chain: the lagging auditor's transition counter names index 3, only the submitter is slashed`: REQ-SP-9-RNXP56.T6.P17, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P92
