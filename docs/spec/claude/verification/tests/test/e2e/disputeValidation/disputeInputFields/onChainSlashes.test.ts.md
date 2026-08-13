# test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Three tests attack `dispute.input.onChainSlashes`. First, a disputer appends an address that was
never slashed on-chain; the dispute commits, an honest peer kills it, and honest peers store a
`DisputeOnChainSlashesNotSubset` proof (resolution runs without asserting attacker removal, since
the winning counter-dispute is not controlled). Second, a participant is genuinely slashed and
evicted through a full dispute-and-resolve cycle, then a later dispute lists that address even
though it is no longer in the snapshot's participants — killed as `InvalidDisputeReason`. Third, a
dispute lists 8 random addresses (more than `maxSlashCount`); the oracle is that reduction must
not out-of-bounds panic, the fork resolves, and `slashedOnChainExactly` pins the final on-chain
slash set to exactly the two real offenders. Each test covers one side of the subset rule; the
matching spec permutations bundle the valid-subset case with these violations (or add
retry/recovery), so none is fully covered by a single test here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                             | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [`E2E: dispute validation / disputeInputFields / onChainSlashes > dispute.input.onChainSlashes includes address not slashed on-chain → DisputeOnChainSlashesNotSubset`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts#L6) (line 6)                         | —      |
| [`E2E: dispute validation / disputeInputFields / onChainSlashes > dispute.input.onChainSlashes contains address not in latestStateSnapshot participants → InvalidDisputeReason`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts#L48) (line 48)              | —      |
| [`E2E: dispute validation / disputeInputFields / onChainSlashes > dispute.input.onChainSlashes has > maxSlashCount distinct addresses → reduce must not OOB-panic, both offenders slashed`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/onChainSlashes.test.ts#L107) (line 107) | —      |
