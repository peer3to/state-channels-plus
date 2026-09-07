# test/utils/DetachedPromises.test.ts — Test Report

> **Test file:** [test/utils/DetachedPromises.test.ts](../../../../../../test/utils/DetachedPromises.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [DetachedPromises.ts](../../../../implementation/source/src/utils/DetachedPromises.ts.md)

## Overview

A fulfilled operation is collected without calling its error route. A rejected operation calls the route once with the same error object and retains that rejection in the drain.

## Tests and covered test IDs

| Test                                                                                                                                                                 | Covers                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`DetachedPromises.observe > collects fulfilled work without calling the error route`](../../../../../../test/utils/DetachedPromises.test.ts#L5) (line 5)            | [`UNIT-TEST-DETACHED-OBSERVE-1-VS9S55.P1`](../../../../implementation/source/src/utils/DetachedPromises.ts.md#unit-test-detached-observe-1-vs9s55.p1) |
| [`DetachedPromises.observe > routes the original rejection once and preserves it in the drain`](../../../../../../test/utils/DetachedPromises.test.ts#L15) (line 15) | [`UNIT-TEST-DETACHED-OBSERVE-1-VS9S55.P2`](../../../../implementation/source/src/utils/DetachedPromises.ts.md#unit-test-detached-observe-1-vs9s55.p2) |
