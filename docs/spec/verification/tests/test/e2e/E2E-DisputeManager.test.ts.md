# E2E-DisputeManager.test.ts

Test file: [test/e2e/E2E-DisputeManager.test.ts](../../../../../../test/e2e/E2E-DisputeManager.test.ts)

## Overview

The suite runs three to four real peer hosts through the MathTestSession harness and drives the
whole dispute pipeline: a byzantine stimulus (invalid state transition, double-sign, or a tampered
dispute posted straight to the contract) triggers detection, dispute construction and upload by
`DisputeManager`, on-chain commitment, kill auditing, and reduction to a successor fork. Oracles
are protocol events (`onInitiatingDispute`, `onDisputeCommitted`, `onDisputeKilled`,
`onStateSnapshotUpdated`), stored dispute fraud-proof types, on-chain slashed participants, fork
settlement via `resolveDisputeWait`, and post-resolution snapshot posting. Both submission paths
run: a settled fork disputes without auditing calldata, a pending-join fork with it. The
fraud-proof group kills internally valid but baseless or tampered disputes (`InvalidDisputeReason`,
`DisputeInvalidStateProof`). The partial-syncing group shows a disconnected peer recovering
committed disputes and reducing from persisted proof data, and peers storing block/state data
delivered by a dispute for heights they never received. The pending-join writer-timeout test is
skipped on a known product race. Per-field dispute-input and state-proof audits are out of scope
(`test/e2e/disputeValidation/*`), as are `DisputeManager` branch permutations
(`test/unit/DisputeManager.test.ts`). After the permutation split, the single-scenario
dispute-input, kill, and recovery permutations demonstrated here are assigned below; per-predicate
audit permutations stay with the `test/e2e/disputeValidation/*` suites.

State-only contribution checks use the shared real-audit action, including its existing protocol-derived host RPC budget, instead of the quick-read RPC default. The valid verdict, absence of a fraud proof and successful reduction are unchanged.

## Tests

- `an accepted state contribution keeps its reason after the original opener is killed`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P22
- `a closed-window refusal rebuilds from a slash already delivered after construction`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P25
- `a held state contribution survives an opener kill while the window stays open`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P23
- `a held state contribution refreshes authoritative slashes after the opener is killed and the window closes`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P24
- `a state-only contribution is accepted without auditing calldata in an existing window`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P17
- `a state-only contribution is accepted with auditing calldata in an existing window`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P18
- `a state-only contribution without an existing window is refused without a slash`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P19
- `a state-only contribution after the evidence deadline is refused without a slash`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P20
- `should reduce invalid state transition disputes and create new fork`: INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P1, REQ-DIS-1-XAJ1VA.T1.P1
- `every honest peer racing to dispute the same invalid block lands its dispute`: REQ-SDK-ARCH-5-AAM7YK.T1.P6
- `should post a dispute WITH auditing calldata on a pending-join fork`: none
- `should post updated state snapshot after fork resolution`: REQ-DIS-9-64WHCD.T1.P1
- `should dispute a timed-out writer on a pending-join fork with auditing calldata`: none
- `should kill a spam dispute with no legitimate enforcement basis`: INTEGRATION-TEST-DISPUTE-PIPE-1-BPTFY9.P2
- `should reject dispute when auditing data is partial and state proof invalid`: none
- `should reject dispute when full auditing data reconstructed but both commitment and state proof are invalid`: none
- `recovers an expired posted-data dispute and reduces from persisted proof data`: REQ-DIS-4-6J6YYG.T1.P16, REQ-DISPUTE-PIPE-1-HRBFP7.T1.P4
- `should have missing state Storage when peer receives dispute with blocks it doesn't have`: none
- `should handle valid dispute when validating peer is missing snapshot data`: none
