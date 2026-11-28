# E2E-DisputeAuditFatal.test.ts

Test file: [test/e2e/E2E-DisputeAuditFatal.test.ts](../../../../../../test/e2e/E2E-DisputeAuditFatal.test.ts)

## Overview

Injects execution and data-access failures into real dispute audits. A failing read surfaces as a fatal error rather than a false proof verdict or a fabricated counter. Absent local data (a deleted replay base state or milestone snapshot) leaves the proof not judged: no counter and no kill, the dispute is stored as audited, and the auditor's own dispute build runs and stops on the same missing data.

Required-state deletion uses the stub control service; required snapshot deletion also retains its genesis guard.

## Tests

- `E21: a verification read that throws during a live audit is fatal: no fraud proof, no kill, no dispute, and no fallback to the chain read`: REQ-SP-9-RNXP56.T5.P7, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P58
- `E21: an auditor missing the full finalized state its replay starts from does not judge the tail: no fraud proof, no kill; the dispute is stored as audited and its own dispute build runs, which stops on the same missing state`: REQ-SP-9-RNXP56.T5.P8, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P59
- `E21: an auditor that cannot build the on-chain evidence for a proof it cannot verify (a milestone snapshot it must hold is missing) does not judge the proof: no unsupported counter, no kill; the dispute is stored as audited and its own dispute build runs, which stops on the same missing snapshot`: REQ-SP-9-RNXP56.T5.P9, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P60
