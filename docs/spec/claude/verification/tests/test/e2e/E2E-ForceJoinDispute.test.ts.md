# test/e2e/E2E-ForceJoinDispute.test.ts — Test Report

> **Test file:** [test/e2e/E2E-ForceJoinDispute.test.ts](../../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single workflow test: a spectator joins a two-peer channel, both members stub pending-inbound
inclusion so three produced blocks omit the join message, and the third missed turn triggers the
force-join dispute. The test then resolves the dispute window through reduction and asserts the
joiner's status flips `PENDING_PARTICIPANT` → `PARTICIPATING` and every peer's on-chain
participant set equals the three-player fork. Oracles are per-peer status queries, on-chain
participant sets, and the harness's fork-settlement wait. This demonstrates forced inbound
inclusion as a dispute input end to end, but no planned permutation is assigned: the relevant
plans (`REQ-DIS-1`, the join/admission tables) bundle several scenarios per permutation, which
this single test does not cover in full.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                               | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: Force Join Dispute > should trigger force-join dispute after N turns of non-inclusion, then resolve with joiner PARTICIPATING`](../../../../../../../test/e2e/E2E-ForceJoinDispute.test.ts#L6) (line 6) | —      |
