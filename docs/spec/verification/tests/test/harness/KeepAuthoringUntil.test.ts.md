# test/harness/KeepAuthoringUntil.test.ts — Test Report

> **Test file:** [test/harness/KeepAuthoringUntil.test.ts](../../../../../../test/harness/KeepAuthoringUntil.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** the harness helper [test/harness/actions/TransitionActions.ts](../../../../../../test/harness/actions/TransitionActions.ts) (`keepAuthoringUntil`, with the math `add(1)` default in [MathTransitionActions.ts](../../../../../../test/harness/actions/math/MathTransitionActions.ts)); harness code has no source report.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Two cases for the keep-alive helper's bound on a live three-participant channel. The first excludes the peer whose turn it is and never satisfies the condition, so no block can be authored; the helper must still end in its diagnostic after the configured number of writer windows, naming the authored and waited windows and each peer's status and height. The second denies the writer turn on every host, so the next-writer answer is never confirmed, and proves the waiting windows reach the same bound with the same diagnostic. The third authors real blocks and proves they count toward the bound. The helper is harness code, so both rows stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                             | Covers |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`keepAuthoringUntil helper > ends in its diagnostic when the next writer stays excluded`](../../../../../../test/harness/KeepAuthoringUntil.test.ts#L7) (line 7)            | —      |
| [`keepAuthoringUntil helper > ends in its diagnostic when no host confirms the next writer's turn`](../../../../../../test/harness/KeepAuthoringUntil.test.ts#L33) (line 33) | —      |
| [`keepAuthoringUntil helper > counts authored blocks toward the same bound`](../../../../../../test/harness/KeepAuthoringUntil.test.ts#L64) (line 64)                        | —      |
