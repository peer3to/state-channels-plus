# test/e2e/E2E-Fuzz-Dispute-MVP.test.ts — Test Report

> **Test file:** [test/e2e/E2E-Fuzz-Dispute-MVP.test.ts](../../../../../../../test/e2e/E2E-Fuzz-Dispute-MVP.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A seeded fuzz campaign over the dispute pipeline: each rep draws the peer count (4–6) and step
count (8–14) from `SeededRng`, starts a real channel under a fast time config, and interleaves
honest state evolution with randomized byzantine attacks from `DISPUTE_SOUNDNESS_MENU` via
`runFuzzCampaign`. The oracle is the soundness invariant checked after every step: surviving
honest peers stay in sync (`onlyHonestPeersInSync`) and attackers are contained without honest
loss. Seed and config are logged up front so any failure replays with `SEED=<n>`. Because each
run's action sequence is randomized, no fixed planned permutation is deterministically exercised
in full on every run; the suite is breadth and regression coverage on top of the deterministic
dispute suites, and no test IDs are assigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                      | Covers |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: Fuzz - dispute soundness under randomized state evolution > <dynamic: `rep ${rep}/${REPS}: survivors stay in sync; every attack is contained without honest loss`>`](../../../../../../../test/e2e/E2E-Fuzz-Dispute-MVP.test.ts#L23) (line 23) | —      |
