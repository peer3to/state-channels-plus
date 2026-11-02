# StorageDiffCli.test.ts

Test file: [test/utils/node/StorageDiffCli.test.ts](../../../../../../../test/utils/node/StorageDiffCli.test.ts)
Exercises: [storageDiffCli.ts](../../../../../implementation/source/src/utils/node/storageDiff/storageDiffCli.ts.md)

## Overview

Direct calls to `parseStorageDiffArgs` with flag sets, and two runs of the real script as a child process against an isolated anvil test chain: one serves catch-up, one must fail at startup.

## Tests

- `passes --max-peer-buffered-bytes on as the peer buffer limit`: UNIT-TEST-SDS-CLI-1-8BN5XT.P1
- `leaves the peer buffer limit unset without its flag`: UNIT-TEST-SDS-CLI-1-8BN5XT.P3
- `refuses a flag value that is not a non-negative integer`: UNIT-TEST-SDS-CLI-1-8BN5XT.P9
- `refuses an unknown flag`: UNIT-TEST-SDS-CLI-1-8BN5XT.P10
- `starts the script and serves catch-up up to the upstream's head`: UNIT-TEST-SDS-CLI-1-8BN5XT.P13
- `fails the script at startup when --max-peer-buffered-bytes is zero`: UNIT-TEST-SDS-CLI-1-8BN5XT.P12
