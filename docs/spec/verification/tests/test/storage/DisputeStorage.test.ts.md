# DisputeStorage.test.ts

Test file: [test/storage/DisputeStorage.test.ts](../../../../../../test/storage/DisputeStorage.test.ts)
Exercises: [DisputeStorage.ts](../../../../implementation/source/src/storage/DisputeStorage.ts.md)

## Overview

The suite drives `DisputeStorage` directly with factory-built signed disputes: `storeDispute`
and `storeDisputeConfirmation` under computed and caller-provided hashes, `getDisputeConfirmation`
reads, signature-set merging with deduplication across repeated stores, preservation of the
original signed dispute when a different one arrives under the same hash, and behavior with
empty and large signature arrays plus several independent disputes side by side. The oracles
assert the returned hash, the stored signed dispute's identity, and the exact merged signature
sets. The per-fork disputed/own-dispute flags are not exercised anywhere in this file, and no
test permutes merge order, re-delivers an identical complete confirmation, or decodes the stored
dispute, so those permutations stay unassigned.

## Tests

- `should store SignedDispute with auto-computed hash and return hash with empty signatures`: REQ-DSTORE-1-5AQYJX.T1.P1, UNIT-TEST-DISPUTE-STORAGE-1-82MB79.P1
- `should store SignedDispute with provided hash`: none
- `should return same hash on duplicate insert and preserve existing signatures`: none
- `should store DisputeConfirmation with auto-computed hash`: none
- `should store DisputeConfirmation with provided hash`: none
- `should merge signatures with deduplication on duplicate insert`: none
- `should handle empty signatures array`: none
- `should preserve original SignedDispute when merging signatures`: none
- `should get dispute confirmation by hash`: none
- `should return undefined for non-existent dispute`: none
- `should handle multiple different disputes`: none
- `should maintain signatures across different storage methods`: none
- `should handle large signature arrays efficiently`: none
