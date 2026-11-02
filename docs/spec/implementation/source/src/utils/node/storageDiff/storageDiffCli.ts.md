# storageDiffCli.ts

> **Source:** [src/utils/node/storageDiff/storageDiffCli.ts](../../../../../../../../src/utils/node/storageDiff/storageDiffCli.ts)

No specified behavior: parses the command line of the standalone service script; it defines no protocol behavior.

## UNIT-TEST-SDS-CLI-1-8BN5XT

`parseStorageDiffArgs` turns the flags of the standalone service into its options, and the script starts and serves catch-up or fails at startup accordingly.

- Setup: Parse flag sets for the peer buffer limit, a non-integer value and an unknown flag; start the script plainly and with a zero buffer limit.
- Oracle: Options equal the flags, defaults stay unset without their flags, bad input is refused, and the script serves catch-up up to the upstream's head or exits nonzero.

- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P1` — --max-peer-buffered-bytes is passed on as the peer buffer limit
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P3` — the peer buffer limit is unset without its flag
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P9` — a flag value that is not a non-negative integer is refused
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P10` — an unknown flag is refused
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P12` — the script fails at startup when --max-peer-buffered-bytes is zero
- [x] `UNIT-TEST-SDS-CLI-1-8BN5XT.P13` — the script starts and serves catch-up up to the upstream's head
