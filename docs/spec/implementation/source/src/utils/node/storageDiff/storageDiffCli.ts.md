# storageDiffCli.ts

> **Source:** [src/utils/node/storageDiff/storageDiffCli.ts](../../../../../../../../src/utils/node/storageDiff/storageDiffCli.ts)

No specified behavior: parses the command line of the standalone service script; it defines no protocol behavior.

## UNIT-TEST-SDS-CLI-1-8BN5XT

`parseStorageDiffArgs` turns the flags of the standalone service into its options, and the script starts and serves catch-up or fails at startup accordingly.

- Setup: Parse flag sets for the peer buffer limit, every other limit, the Asset Hub block source, repeated allowed origins, the upstream from the environment with and without `--upstream`, a non-integer value and an unknown flag; start the script plainly and with a zero buffer limit.
- Oracle: Options equal the flags, the Asset Hub URL selects the child trie block source, defaults stay unset without their flags, `--upstream` wins over the environment, a missing upstream and bad input are refused, and the script serves catch-up up to the upstream's head or exits nonzero.

- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P1` — --max-peer-buffered-bytes is passed on as the peer buffer limit
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P3` — the peer buffer limit is unset without its flag
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P9` — a flag value that is not a non-negative integer is refused
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P10` — an unknown flag is refused
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P12` — the script fails at startup when --max-peer-buffered-bytes is zero
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P13` — the script starts and serves catch-up up to the upstream's head
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P14` — each limit flag is passed on as its service option
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P15` — every --allow-origin is passed on as an allowed origin
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P16` — the upstream URL is read from STORAGE_DIFF_UPSTREAM_URL without --upstream
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P17` — --upstream is taken over STORAGE_DIFF_UPSTREAM_URL
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P18` — the script refuses to start without --upstream or STORAGE_DIFF_UPSTREAM_URL
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P19` — backfill blocks are listed through the Asset Hub child trie with --asset-hub-substrate-url and the default is left without it
