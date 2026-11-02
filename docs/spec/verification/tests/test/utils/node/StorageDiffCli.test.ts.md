# StorageDiffCli.test.ts

Test file: [test/utils/node/StorageDiffCli.test.ts](../../../../../../../test/utils/node/StorageDiffCli.test.ts)
Exercises: [storageDiffCli.ts](../../../../../implementation/source/src/utils/node/storageDiff/storageDiffCli.ts.md)

## Overview

Direct calls to `parseStorageDiffArgs` with flag sets (one with and one without the Asset Hub URL, checking the block source it builds), and two runs of the real script as a child process against an isolated anvil test chain: one serves catch-up, one must fail at startup.

## Tests

- `passes --max-peer-buffered-bytes on as the peer buffer limit`: UNIT-TEST-SDS-CLI-1-8BN5XT.P1
- `leaves the peer buffer limit unset without its flag`: UNIT-TEST-SDS-CLI-1-8BN5XT.P3
- `lists backfill blocks through the Asset Hub child trie with --asset-hub-substrate-url, and leaves the default without it`: UNIT-TEST-SDS-CLI-1-8BN5XT.P19
- `refuses a flag value that is not a non-negative integer`: UNIT-TEST-SDS-CLI-1-8BN5XT.P9
- `passes each limit flag on as its service option`: UNIT-TEST-SDS-CLI-1-8BN5XT.P14
- `passes every --allow-origin on as an allowed origin`: UNIT-TEST-SDS-CLI-1-8BN5XT.P15
- `reads the upstream URL from STORAGE_DIFF_UPSTREAM_URL without --upstream`: UNIT-TEST-SDS-CLI-1-8BN5XT.P16
- `takes --upstream over STORAGE_DIFF_UPSTREAM_URL`: UNIT-TEST-SDS-CLI-1-8BN5XT.P17
- `refuses to start without --upstream or STORAGE_DIFF_UPSTREAM_URL`: UNIT-TEST-SDS-CLI-1-8BN5XT.P18
- `refuses an unknown flag`: UNIT-TEST-SDS-CLI-1-8BN5XT.P10
- `starts the script and serves catch-up up to the upstream's head`: UNIT-TEST-SDS-CLI-1-8BN5XT.P13
- `fails the script at startup when --max-peer-buffered-bytes is zero`: UNIT-TEST-SDS-CLI-1-8BN5XT.P12
