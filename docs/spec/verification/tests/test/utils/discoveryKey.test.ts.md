# discoveryKey.test.ts

Test file: [test/utils/discoveryKey.test.ts](../../../../../../test/utils/discoveryKey.test.ts)
Exercises: [discoveryKey.ts](../../../../implementation/source/src/utils/discoveryKey.ts.md)

## Overview

Derive raw and domain-separated keys with boundary hex inputs and compare exact bytes/errors; direct validator cases assert caller error and void return.

These cases verify that channel discovery uses the exact bytes32 channel ID and rejects text or
short-hex values before transport discovery starts.

## Tests

- `uses the exact channel ID bytes and rejects invalid values`: UNIT-TEST-P2P-MANAGER-2-HR5HCB.P3

The direct `targeted join topic is domain-separated from the raw channel key` case proves deterministic
`solidityPackedKeccak256(["string", "bytes32"], ["targeted-channel-join", channelId])`, exact 32-byte output,
and inequality with the unchanged raw discovery key.

- `targeted join topic is domain-separated from the raw channel key`: none
- `rejects short IDs in both discovery derivations`: UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P1
- `rejects long IDs in both discovery derivations`: UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P2
- `rejects malformed IDs in both discovery derivations`: UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P3
- `preserves mixed-case channel bytes and targeted derivation`: UNIT-TEST-DISCOVERY-KEY-32-F0QWHX.P4
- `uses the caller message for undefined bytes32 input`: UNIT-TEST-BYTES32-32-E6KC18.P1
- `validates bytes32 without returning a normalized value`: UNIT-TEST-BYTES32-32-E6KC18.P2
