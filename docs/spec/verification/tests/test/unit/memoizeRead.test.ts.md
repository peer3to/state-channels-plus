# memoizeRead.test.ts

Test file: [test/unit/memoizeRead.test.ts](../../../../../../test/unit/memoizeRead.test.ts)
Exercises: [memoizeRead.ts](../../../../implementation/source/src/utils/memoizeRead.ts.md)

## Overview

Wraps a counting async read with `memoizeRead`. Checks that concurrent callers share one read, that a later call gets the stored value, that a rejected read reaches its caller and is read again on the next call, and that concurrent callers of a rejecting read share its one error.

## Tests

- `two calls before the read settles -> one read, both get its value`: UNIT-TEST-MEMOIZE-READ-1-2TXD31.P1
- `a call after the read resolved -> the stored value, no new read`: UNIT-TEST-MEMOIZE-READ-1-2TXD31.P2
- `a read that rejects -> the caller gets the error, and the next call reads again`: UNIT-TEST-MEMOIZE-READ-1-2TXD31.P3
- `two calls on a read that rejects -> both get the error from one read`: UNIT-TEST-MEMOIZE-READ-1-2TXD31.P4
