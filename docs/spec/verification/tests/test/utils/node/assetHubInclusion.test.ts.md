# assetHubInclusion.test.ts

Test file: [test/utils/node/assetHubInclusion.test.ts](../../../../../../../test/utils/node/assetHubInclusion.test.ts)
Exercises: [assetHubInclusion.ts](../../../../../implementation/source/src/utils/node/storageDiff/includedHead/assetHubInclusion.ts.md)

## Overview

Direct calls to the hashing, key and decoding helpers with reference digests and keys and values recorded from Polkadot nodes.

## Tests

- `hashes the empty input to the BLAKE2b-256 reference digest`: UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P1
- `hashes the RFC 7693 input abc to its BLAKE2b-256 digest`: UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P2
- `hashes inputs around the 128-byte block boundary to the reference digests`: UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P3
- `hashes multi-block inputs to the reference digests`: UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P4
- `hashes 32-byte slot keys and inputs around the block boundary like @noble/hashes`: UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P11
- `derives the recorded Paras::Heads key of Asset Hub from its para id`: UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P5
- `derives the recorded Paras::Heads keys of other parachains from their para ids`: UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P6
- `derives the recorded Revive::BlockHash keys from the block numbers`: UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P7
- `decodes a recorded parachain head to the included block number and Substrate hash`: UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P8
- `refuses a parachain head that is shorter than its declared length`: UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P9
- `refuses a para id that is not a u32`: UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P10
