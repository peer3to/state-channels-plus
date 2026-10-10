# Dispute Pipeline

> **Specification subject:** [Dispute Intake, Verification, and Reduction Pipeline](../../../../specification/disputes/dispute-processing.md)

## INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9

- Specification: [`INV-DISPUTE-PIPE-1-BN0K81` (Equivalent audit)](../../../../specification/disputes/dispute-processing.md#inv-dispute-pipe-1-bn0k81), [`REQ-DISPUTE-PIPE-1-HRBFP7` (Bound intake)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7), [`REQ-DISPUTE-PIPE-2-MJRJV1` (Ordered complete verification)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-2-mjrjv1), [`REQ-DISPUTE-PIPE-3-PHE3SQ` (Deterministic reduction)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq), [`REQ-DISPUTE-PIPE-4-3YVDSA` (Atomic recovery)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-4-3yvdsa)
- Specification tests: All applicable specification permutations
- Setup: Exercise the complete concrete subsystem through each documented entry and failure boundary.
- Oracle: The subsystem preserves the neutral behavior and contains failure without partial state.

- [x] `INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P1` — success
- [x] `INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P2` — validation rejection
- [x] `INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P4` — operational failure
