# keys.test.ts

Test file: [keys.test.ts](../../../../../../test/storage/keys.test.ts)
Exercises: [keys.ts.md](../../../../implementation/source/src/storage/keys.ts.md)

## Overview

Use real fork hashes and zero/positive heights; output equals the original colon-joined representation and separates coordinates.

The evidence-key cases use real hashes: each key equals the prefix the evidence store design fixes followed by the
hash, and a sync key is told from an audit key that carries the same hash.

## Tests

- `preserves zero-height coordinates`: UNIT-TEST-KEYS-32-FMYDFT.P1
- `separates positive heights and fork identities`: UNIT-TEST-KEYS-32-FMYDFT.P2
- `keys audit evidence as dispute:<disputeHash>`: UNIT-TEST-KEYS-33-YJ66W1.P1
- `keys sync evidence as sync:<finalizedSnapshotHash>`: UNIT-TEST-KEYS-33-YJ66W1.P2
- `tells sync evidence keys from audit evidence keys of the same hash`: UNIT-TEST-KEYS-33-YJ66W1.P3
