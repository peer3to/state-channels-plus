# SignatureCollectionMap.test.ts

Test file: [test/utils/SignatureCollectionMap.test.ts](../../../../../../test/utils/SignatureCollectionMap.test.ts)
Exercises: [SignatureCollectionMap.ts](../../../../implementation/source/src/utils/SignatureCollectionMap.ts.md)

## Overview

Use real signed values across multiple keys; compare fresh ordered arrays and live iteration after callback mutation.

A pure in-memory unit drive of `SignatureCollectionMap` — `tryInsert`, `has`, `hasSignature`,
`getSignatures`, `didEveryoneSign`, `delete`, `clear`, and `size` — with string keys, fixed
addresses, and placeholder signature strings, under sinon fake timers for the optional TTL. The
oracles assert per-address deduplication (a second signature from the same address is ignored),
completeness checks against a participant list (including a missing signer and a non-existent
key), and the timeout path: an entry with `timeoutMs` evicts exactly at expiry, an entry without
one never evicts, and manual deletion cancels the pending timer without a late-firing error. Out
of scope: real cryptographic signatures, address case/checksum normalization, and every
protocol-level consumer of collected signatures. The seed pool defines no permutations for this
component, so no test IDs are assignable here.

## Tests

- `should insert a new signature`: none
- `should insert multiple signatures for the same key`: none
- `should prevent duplicate signatures from the same address`: none
- `should return true when all participants have signed`: none
- `should return false when not all participants have signed`: none
- `should return false for non-existent key`: none
- `should delete entries`: none
- `should clear all entries`: none
- `should set timeout when provided`: none
- `should not timeout when no timeout provided`: none
- `should clear timeout when manually deleting`: none
- `projects ordered signatures into fresh arrays and preserves live callback iteration`: UNIT-TEST-SIGNATURE-COLLECTION-MAP-32-KB4QYC.P1
