# StorageDiffLogs.test.ts

Test file: [test/utils/node/StorageDiffLogs.test.ts](../../../../../../../test/utils/node/StorageDiffLogs.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Cases emit events from deployed contracts, with and without storage writes, subscribe before and after, and count the `eth_getLogs` requests the upstream receives per block. The oracles are the logs on pushed and caught-up records and the request counts.

## Tests

- `attaches the log of a subscribed address to the record of the block that emitted it`: REQ-SDS-5-B2V01N.T1.P1
- `asks the upstream for logs once per block whose logs bloom matches a subscribed address`: REQ-SDS-5-B2V01N.T1.P2
- `asks the upstream for no logs of a block whose logs bloom matches no subscribed address or that has no transactions`: REQ-SDS-5-B2V01N.T1.P3
- `asks the upstream for no logs of a block whose only log is from an address nobody subscribed to`: REQ-SDS-5-B2V01N.T1.P4
- `attaches the log of a contract call that emits an event and changes no storage`: REQ-SDS-5-B2V01N.T1.P5
- `fetches the missing logs once when a later catch-up asks for the address`: REQ-SDS-5-B2V01N.T1.P6
- `returns the logs of a subscribed address in the catch-up of its block`: REQ-SDS-5-B2V01N.T1.P7
- `leaves the logs of other addresses out of a catch-up`: REQ-SDS-5-B2V01N.T1.P8
- `replaces the logs of a rolled back block with those of its replacement`: REQ-SDS-5-B2V01N.T1.P9
- `retries a log fetch the upstream answered with an error and pushes the record with its log`: REQ-SDS-5-B2V01N.T1.P10
