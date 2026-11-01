# StorageDiffCli.test.ts

Test file: [test/utils/node/StorageDiffCli.test.ts](../../../../../../../test/utils/node/StorageDiffCli.test.ts)
Exercises: [storageDiffCli.ts](../../../../../implementation/source/src/utils/node/storageDiff/storageDiffCli.ts.md)

## Overview

Direct calls to `parseStorageDiffArgs` with flag sets, and two runs of the real script as a child process against an isolated anvil test chain: one serves the included head, one must fail at startup.

## Tests

- `passes --max-peer-buffered-bytes on as the peer buffer limit`: UNIT-TEST-SDS-CLI-1-8BN5XT.P1
- `passes --cache-dir on as the cache directory, and leaves it unset without the flag`: UNIT-TEST-SDS-CLI-1-8BN5XT.P2
- `leaves the peer buffer limit and the inclusion strategy unset without their flags`: UNIT-TEST-SDS-CLI-1-8BN5XT.P3
- `lists backfill blocks through the Asset Hub child trie with the relay flags, and leaves the default without them`: UNIT-TEST-SDS-CLI-1-8BN5XT.P4, UNIT-TEST-SDS-CLI-1-8BN5XT.P6
- `builds the relay strategy for the para id of --included-para-id`: UNIT-TEST-SDS-CLI-1-8BN5XT.P5
- `refuses a relay URL without an Asset Hub URL`: UNIT-TEST-SDS-CLI-1-8BN5XT.P7
- `refuses the dev depth together with the relay flags`: UNIT-TEST-SDS-CLI-1-8BN5XT.P8
- `refuses a flag value that is not a non-negative integer`: UNIT-TEST-SDS-CLI-1-8BN5XT.P9
- `refuses an unknown flag`: UNIT-TEST-SDS-CLI-1-8BN5XT.P10
- `starts the script with the dev inclusion flag and serves the included head`: UNIT-TEST-SDS-CLI-1-8BN5XT.P11
- `fails the script at startup when --max-peer-buffered-bytes is zero`: UNIT-TEST-SDS-CLI-1-8BN5XT.P12
