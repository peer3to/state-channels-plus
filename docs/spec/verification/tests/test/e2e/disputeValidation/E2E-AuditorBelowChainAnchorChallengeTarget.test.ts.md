# E2E-AuditorBelowChainAnchorChallengeTarget.test.ts

Test file: [test/e2e/disputeValidation/E2E-AuditorBelowChainAnchorChallengeTarget.test.ts](../../../../../../../test/e2e/disputeValidation/E2E-AuditorBelowChainAnchorChallengeTarget.test.ts)

## Overview

Audits by a peer cut off from gossip after block 1, whose own finalized state is below a newer chain anchor (block 2) and which therefore audits on the chain tier, next to a current auditor that walks from its own finalized state. Checks the chain tier, protected prefixes and original last-milestone indices for genuine tail faults.

## Tests

- `E33: an auditor whose own finalized state is below the chain anchor kills an eligible tail offense on chain at its position from the last milestone's start, the same position an auditor on its own finalized state stores; the chain-tier auditor is not slashed`: REQ-SP-9-RNXP56.T6.P11, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P86
- `E33 ext: anchor in the middle of the last milestone → the chain-tier auditor and the one on its own finalized state both target the shifted position (index 3), the chain-tier auditor's kill lands, only the submitter is slashed`: REQ-SP-9-RNXP56.T6.P12, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P87
- `E33 ext: structure fault at the position following the boundary (index 3 after the anchor at index 2) → the chain-tier auditor's DisputeInvalidBlockStructure names index 3 and kills the dispute, only the submitter is slashed`: REQ-SP-9-RNXP56.T6.P13, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P88
- `E33 ext: forged block below the chain anchor (block 1, so the anchor at the boundary index no longer links) with an honest block after it → the chain tier replays from the anchor: no false accusation, no kill, the submitter is not slashed`: REQ-SP-9-RNXP56.T6.P14, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P89
- `E33 ext: forged block below the chain anchor plus a genuine invalid transition two blocks after the anchor → the transition counter from the chain anchor names that block (index 4), the chain-tier auditor's kill lands, only the submitter is slashed`: REQ-SP-9-RNXP56.T6.P15, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P90
- `E33 ext: defect below the chain anchor (block 2) in a proof ending at the chain anchor → the chain check protects it: no block-specific challenge, no kill`: REQ-SP-9-RNXP56.T6.P16, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P91
- `E33 ext: the same defect below the chain anchor plus an invalid transition right after the chain cutoff (control) → escalates on chain: the chain-tier auditor's transition counter names index 3, only the submitter is slashed`: REQ-SP-9-RNXP56.T6.P17, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P92
