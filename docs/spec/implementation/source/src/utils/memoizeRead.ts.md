# memoizeRead.ts

> **Source:** [src/utils/memoizeRead.ts](../../../../../../src/utils/memoizeRead.ts)

No specified behavior: a generic helper that shares one read of an unchanging value among its callers.

## UNIT-TEST-MEMOIZE-READ-1-2TXD31

A memoized read is made once and shared by every caller, and a failed read is forgotten so the next call reads again.

- Setup: Wrap a counting async read with `memoizeRead`; call it concurrently, after it resolves, and after it rejects
- Oracle: The values or errors each caller receives and the number of underlying reads

- [x] `UNIT-TEST-MEMOIZE-READ-1-2TXD31.P1` — two calls before the read settles: one read, both get its value
- [x] `UNIT-TEST-MEMOIZE-READ-1-2TXD31.P2` — a call after the read resolved: the stored value, no new read
- [x] `UNIT-TEST-MEMOIZE-READ-1-2TXD31.P3` — a read that rejects: the caller gets the error, and the next call reads again
- [x] `UNIT-TEST-MEMOIZE-READ-1-2TXD31.P4` — two calls on a read that rejects: both get the error from one read
