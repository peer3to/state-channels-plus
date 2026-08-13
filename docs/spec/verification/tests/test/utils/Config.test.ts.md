# test/utils/Config.test.ts — Test Report

> **Test file:** [test/utils/Config.test.ts](../../../../../../test/utils/Config.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [config.ts](../../../../implementation/source/src/utils/config.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives `createConfig` in a Node (mocha) runtime with a controlled `process.env` — it
saves and restores `HOLEPUNCH_RELAYER_URLS`, `DEBUG_LOCAL_TRANSPORT`, and `LOG_LEVEL` around each
case, stubs `console.log`, and resets the process-lifespan config in `afterEach`. The oracles read
fields off the resolved public config object. Covered precedence steps: the checked-in
`peer3.config.ts` file value wins over the built-in default (`DEBUG_LOCAL_TRANSPORT` true vs
false), an environment value wins over the file value for `HOLEPUNCH_RELAYER_URLS` (the file sets
a different relay URL) in both the JSON-array and comma-separated spellings, and an explicit
`createConfig` override wins over the environment. Out of scope: the browser and worker-host
runtimes, the full field/type-coercion matrix, malformed-value fallback, secret handling, and
whole-participant startup ([`INTEGRATION-TEST-CONFIG-1-9228HJ`](../../../../implementation/views/operations/configuration.md#integration-test-config-1-9228hj)). The pool now defines one permutation
per value spelling; the JSON-array and comma-separated-array spellings exercised here are
assigned, while the boolean spellings, number/malformed/empty values, and the space-separated
array spelling have no test in this suite.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                | Covers                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`config env parsing > applies peer3.config.ts as baseConfig`](../../../../../../test/utils/Config.test.ts#L42) (line 42)                       | [`REQ-CFG-1-W7C6C6.T1.P2`](../../../../implementation/views/operations/configuration.md#req-cfg-1-w7c6c6.t1.p2)                                                                                                                    |
| [`config env parsing > parses HOLEPUNCH_RELAYER_URLS from env JSON array`](../../../../../../test/utils/Config.test.ts#L48) (line 48)           | [`REQ-CFG-1-W7C6C6.T1.P3`](../../../../implementation/views/operations/configuration.md#req-cfg-1-w7c6c6.t1.p3), [`REQ-CFG-2-FCY3ZR.T1.P3`](../../../../implementation/views/operations/configuration.md#req-cfg-2-fcy3zr.t1.p3)   |
| [`config env parsing > parses HOLEPUNCH_RELAYER_URLS from env comma-separated list`](../../../../../../test/utils/Config.test.ts#L59) (line 59) | [`REQ-CFG-3-9NKNSV.T1.P1`](../../../../implementation/views/operations/configuration.md#req-cfg-3-9nknsv.t1.p1), [`REQ-CFG-2-FCY3ZR.T1.P18`](../../../../implementation/views/operations/configuration.md#req-cfg-2-fcy3zr.t1.p18) |
| [`config env parsing > manual overrides win over env for HOLEPUNCH_RELAYER_URLS`](../../../../../../test/utils/Config.test.ts#L70) (line 70)    | [`REQ-CFG-1-W7C6C6.T1.P4`](../../../../implementation/views/operations/configuration.md#req-cfg-1-w7c6c6.t1.p4)                                                                                                                    |
