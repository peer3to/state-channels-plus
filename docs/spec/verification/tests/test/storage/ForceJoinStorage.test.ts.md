# ForceJoinStorage.test.ts

Test file: [test/storage/ForceJoinStorage.test.ts](../../../../../../test/storage/ForceJoinStorage.test.ts)
Exercises: [ForceJoinStorage.ts](../../../../implementation/source/src/storage/ForceJoinStorage.ts.md)

## Overview

The suite exercises `ForceJoinStorage` directly; it is a pure in-memory record, so no session is
needed. A fresh storage reads no join. A started join reads back with its submission height,
authorization deadline and both flags false; an update by its id returns `true` and every updated
field reads back; a clear returns the absent state. A second clear changes nothing. After a later
join starts, an update naming the earlier id returns `false` and the later record reads back
unchanged.

## Tests

- `a fresh storage holds no join`: UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P1
- `a started join reads back with its initial fields, an update by its id changes it, and clear removes it`: UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P2
- `a second clear is harmless and the join stays absent`: UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P3
- `an update for an earlier submission id returns false and leaves the newer join unchanged`: UNIT-TEST-FORCE-JOIN-STORAGE-1-E2PCWN.P4
