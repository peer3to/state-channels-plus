# PersistentCollection.test.ts

Test file: [test/storage/persistence/PersistentCollection.test.ts](../../../../../../../../test/storage/persistence/PersistentCollection.test.ts)
Exercises: [PersistentCollection.ts](../../../../../../implementation/source/src/storage/persistence/PersistentCollection.ts.md)

## Overview

The suite drives a `PersistentCollection` with no controller through its public map methods: set, overwrite, delete, update and iteration. It checks that without a disk the collection behaves as a `Map` (an overwrite keeps the key's place, a delete then set moves it last), that an update returning nothing deletes the key, and that values are held by reference (the store proxies copy at the boundary).

## Tests

- `keeps map semantics without a disk: set, overwrite, delete and iteration order`: REQ-STOR-7-K1J7EA.T1.P1
- `deletes the key when an update returns nothing`: none
- `holds values by reference`: none
