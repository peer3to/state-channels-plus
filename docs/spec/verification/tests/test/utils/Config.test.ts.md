# Config.test.ts

Test file: [test/utils/Config.test.ts](../../../../../../test/utils/Config.test.ts)
Exercises: [config.ts](../../../../implementation/source/src/utils/config.ts.md)

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
whole-participant startup (`INTEGRATION-TEST-CONFIG-1-9228HJ`). The pool now defines one permutation
per value spelling; the JSON-array and comma-separated-array spellings exercised here are
assigned, while the boolean spellings, number/malformed/empty values, and the space-separated
array spelling have no test in this suite.

## Tests

- `applies peer3.config.ts as baseConfig`: REQ-CFG-1-W7C6C6.T1.P2
- `parses HOLEPUNCH_RELAYER_URLS from env JSON array`: REQ-CFG-1-W7C6C6.T1.P3, REQ-CFG-2-FCY3ZR.T1.P3
- `parses HOLEPUNCH_RELAYER_URLS from env comma-separated list`: REQ-CFG-3-9NKNSV.T1.P1, REQ-CFG-2-FCY3ZR.T1.P18
- `manual overrides win over env for HOLEPUNCH_RELAYER_URLS`: REQ-CFG-1-W7C6C6.T1.P4
