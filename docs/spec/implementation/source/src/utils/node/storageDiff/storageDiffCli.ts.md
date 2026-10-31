# storageDiffCli.ts

> **Source:** [src/utils/node/storageDiff/storageDiffCli.ts](../../../../../../../../src/utils/node/storageDiff/storageDiffCli.ts)

No specified behavior: parses the command line of the standalone service script; it defines no protocol behavior.

## UNIT-TEST-SDS-CLI-1-8BN5XT

`parseStorageDiffArgs` turns the flags of the standalone service into its options, and the script starts, serves the included head or fails at startup accordingly.

- Setup: Parse flag sets for the peer buffer limit, the cache directory, the relay and dev inclusion sources, the Asset Hub block source, a relay URL without an Asset Hub URL, the dev depth with relay flags, a non-integer value and an unknown flag; start the script with the dev inclusion flag and with a zero buffer limit.
- Oracle: Options and strategies equal the flags, defaults stay unset without their flags, inconsistent input is refused, and the script serves the included head or exits nonzero.

- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P1` — --max-peer-buffered-bytes is passed on as the peer buffer limit
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P2` — --cache-dir is passed on as the cache directory and left unset without the flag
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P3` — the peer buffer limit and the inclusion strategy are unset without their flags
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P4` — backfill blocks are listed through the Asset Hub child trie with the relay flags and the default is left without them
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P5` — the relay strategy is built from the relay flags
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P6` — the dev strategy is built from --included-dev-depth
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P7` — a relay URL without an Asset Hub URL is refused
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P8` — the dev depth together with the relay flags is refused
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P9` — a flag value that is not a non-negative integer is refused
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P10` — an unknown flag is refused
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P11` — the script starts with the dev inclusion flag and serves the included head
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P12` — the script fails at startup when --max-peer-buffered-bytes is zero
