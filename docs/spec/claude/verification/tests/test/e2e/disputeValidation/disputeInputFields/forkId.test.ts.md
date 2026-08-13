# test/e2e/disputeValidation/disputeInputFields/forkId.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/disputeInputFields/forkId.test.ts](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/forkId.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The single test checks fork-identity binding from the auditor side: a committed dispute that
targets a forkId honest peers do not track must be left alone. From a genesis channel
(`timeoutSetup(3, 0)`), peer 1 posts a tampered self-removal dispute whose `input.forkId` is a
random hash (timeout and onChainSlashes zeroed so selfRemoval is the only claim). The oracles
assert honest peers observe exactly one `disputeCommitted` event (the junk dispute does land
on-chain), fire no `onDisputeKilled` during a 6-second quiet window since they never audit a fork
they do not track, and each still reports the original genesis forkId afterwards — no peer
switched onto the junk fork. Kill, slashing, and resolution behavior for the junk fork are out of
scope. After the permutation atomization, the wrong-identity permutation is split per identity
field, and this test covers the wrong-fork scenario in full.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                      | Covers                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / disputeInputFields / forkId > current fork == genesis; dispute.input.forkId = random; honest peers stay on genesis`](../../../../../../../../../test/e2e/disputeValidation/disputeInputFields/forkId.test.ts#L7) (line 7) | [`REQ-DISPUTE-PIPE-1-HRBFP7.T1.P6`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-1-hrbfp7.t1.p6) |
