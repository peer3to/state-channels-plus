# DetachedPromises.test.ts

Test file: [test/utils/DetachedPromises.test.ts](../../../../../../test/utils/DetachedPromises.test.ts)
Exercises: [DetachedPromises.ts](../../../../implementation/source/src/utils/DetachedPromises.ts.md)

## Overview

A fulfilled operation is collected without calling its error route. A rejected operation calls the route once with the same error object and retains that rejection in the drain.

## Tests

- `collects fulfilled work without calling the error route`: UNIT-TEST-DETACHED-OBSERVE-1-VS9S55.P1
- `routes the original rejection once and preserves it in the drain`: UNIT-TEST-DETACHED-OBSERVE-1-VS9S55.P2
