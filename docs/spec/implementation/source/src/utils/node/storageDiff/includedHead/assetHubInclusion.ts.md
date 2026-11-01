# assetHubInclusion.ts

> **Source:** [src/utils/node/storageDiff/includedHead/assetHubInclusion.ts](../../../../../../../../../src/utils/node/storageDiff/includedHead/assetHubInclusion.ts)

## Requirements

- [`REQ-SDS-6-SH7DKR` (The included head is a second, final level)](../../../../../../../specification/runtime/storage-diff-service.md#req-sds-6-sh7dkr)

## UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E

The helpers compute BLAKE2b-256 and twox storage keys and decode a relay chain parachain head exactly as recorded Polkadot nodes hold them.

- Setup: Call them with the reference digests' inputs (empty, RFC 7693 `abc`, around the 128-byte block boundary, multi-block), recorded para ids and block numbers, a recorded parachain head, a truncated head and a para id that is not a u32.
- Oracle: Digests and keys equal the references and recordings; the head decodes to the included block number and Substrate hash; malformed input is refused.

- [x] `UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P1` — the empty input hashes to the BLAKE2b-256 reference digest
- [x] `UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P2` — the RFC 7693 input abc hashes to its digest
- [x] `UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P3` — inputs around the 128-byte block boundary hash to the reference digests
- [x] `UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P4` — multi-block inputs hash to the reference digests
- [x] `UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P5` — the recorded Paras::Heads key of Asset Hub is derived from its para id
- [x] `UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P6` — the recorded Paras::Heads keys of other parachains are derived from their para ids
- [x] `UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P7` — the recorded Revive::BlockHash keys are derived from the block numbers
- [x] `UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P8` — a recorded parachain head decodes to the included block number and Substrate hash
- [x] `UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P9` — a parachain head shorter than its declared length is refused
- [x] `UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P10` — a para id that is not a u32 is refused
- [x] `UNIT-TEST-SDS-INCLUSION-HELPERS-1-M6WJ8E.P11` — inputs around the block boundary hash like the independent @noble/hashes BLAKE2b-256
