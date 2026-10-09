# E2E-DisputeAuditFatal.test.ts

Test file: [test/e2e/E2E-DisputeAuditFatal.test.ts](../../../../../../test/e2e/E2E-DisputeAuditFatal.test.ts)

## Overview

Injects execution and data-access failures into real dispute audits. Checks that failures surface as fatal errors rather than false proof verdicts or fabricated counters.

Required-state deletion uses the stub control service; required snapshot deletion also retains its genesis guard.

## Tests

- `E21: a verification read that throws during a live audit is fatal: no fraud proof, no kill, no dispute, and no fallback to the chain read`: REQ-SP-9-RNXP56.T5.P7, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P58
- `E21: an auditor missing the full finalized state its replay starts from is fatal: no fallback to a weaker check, no fraud proof, no kill, no dispute`: REQ-SP-9-RNXP56.T5.P8, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P59
- `E21: an auditor that cannot build the on-chain evidence for a proof it cannot verify (a milestone snapshot it must hold is missing) is fatal: no unsupported counter, no kill, no dispute`: REQ-SP-9-RNXP56.T5.P9, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P60
