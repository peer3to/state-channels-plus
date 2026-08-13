# test/scripts/e2eParallelLogDir.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelLogDir.test.ts](../../../../../../../test/scripts/e2eParallelLogDir.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

This suite unit-tests the CLI and logging helpers of the parallel e2e runner: `parseCliArgs`/`getHelpText` from `scripts/e2e-parallel/shared/argParser.js`, the purge guards and diagnostics in `scripts/e2e-parallel/shared/logging.js`, `accountPartitionFor` from the local scheduler, and `buildBaseEnv`/`main` from `scripts/test-e2e-parallel.js`. One block validates argument parsing: help text documents every option, distributed-only flags are rejected in local mode, `--logDir` rejects empty/CWD/flag-swallowing values, and interval parsing accepts long/short/equals forms while rejecting non-positive values. The destructive-tooling guards get the sharpest oracles: the repo root and filesystem root are dangerous purge targets, `safeEmptyDir` refuses them even with the allow flag (asserted by stubbing `fs.rmSync` and checking nothing was removed), and symlinked log dirs that really point at a protected root are refused before any `mkdir`. A further block checks starvation diagnostics (colorization, recovered-vs-repeated classification, deduplicated watchdog delays with the real peak) and that child environments disable remote crash-log uploads. All components are developer tooling in `scripts/`, not production protocol code, so no specification or implementation test-plan permutation applies to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                | Covers |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`e2e-parallel argParser - logDir validation > does not count interrupted tasks as passing`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L71) (line 71)                                         | —      |
| [`e2e-parallel argParser - logDir validation > exports the runner entry point for package consumers`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L84) (line 84)                                | —      |
| [`e2e-parallel argParser - logDir validation > supports standard help flags and documents every option`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L88) (line 88)                             | —      |
| [`e2e-parallel argParser - logDir validation > parses distributed options and rejects them in local mode`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L118) (line 118)                         | —      |
| [`e2e-parallel argParser - logDir validation > accepts a consumer test filename pattern`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L145) (line 145)                                          | —      |
| [`e2e-parallel argParser - logDir validation > runs all Mocha tests by default and supports --e2e-only`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L156) (line 156)                           | —      |
| [`e2e-parallel argParser - logDir validation > rejects an empty --logDir= value (falls back to default, not provided)`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L161) (line 161)            | —      |
| [`e2e-parallel argParser - logDir validation > rejects '--logDir .' (resolves to CWD)`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L167) (line 167)                                            | —      |
| [`e2e-parallel argParser - logDir validation > does not swallow a following flag as the dir name`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L172) (line 172)                                 | —      |
| [`e2e-parallel argParser - logDir validation > accepts a normal relative dir under logs/`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L178) (line 178)                                         | —      |
| [`e2e-parallel argParser - interval > uses the scheduler default when no interval override is provided`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L186) (line 186)                           | —      |
| [`e2e-parallel argParser - interval > accepts long, short, separated, and equals interval values`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L190) (line 190)                                 | —      |
| [`e2e-parallel argParser - interval > rejects zero and negative interval values`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L201) (line 201)                                                  | —      |
| [`e2e-parallel logging - purge guards > flags the repo root / CWD as a dangerous purge target`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L210) (line 210)                                    | —      |
| [`e2e-parallel logging - purge guards > safeEmptyDir refuses the repo root even with the allow flag`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L217) (line 217)                              | —      |
| [`e2e-parallel logging - purge guards > a symlinked dir whose real target is a dangerous root is flagged, not treated as safe`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L233) (line 233)    | —      |
| [`e2e-parallel logging - purge guards > nextRunDir refuses a './logs -> repo root' symlink (no run-* scattered at the root)`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L254) (line 254)      | —      |
| [`e2e-parallel logging - starvation diagnostics > uses account partitions only when tests share an infrastructure slot`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L274) (line 274)           | —      |
| [`e2e-parallel logging - starvation diagnostics > uses light yellow for rescheduling and dark yellow for repeated starvation`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L279) (line 279)     | —      |
| [`e2e-parallel logging - starvation diagnostics > reports only successful retries as recovered and repeated starvation as yellow`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L291) (line 291) | —      |
| [`e2e-parallel logging - starvation diagnostics > deduplicates propagated watchdog errors and includes their real peak`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L301) (line 301)           | —      |
| [`e2e-parallel logging - starvation diagnostics > counts genuinely different watchdog delays separately`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L316) (line 316)                          | —      |
| [`e2e-parallel child environment > disables remote crash-log uploads because each child has a local run log`](../../../../../../../test/scripts/e2eParallelLogDir.test.ts#L328) (line 328)                      | —      |
