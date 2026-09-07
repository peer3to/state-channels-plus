# test/storage/keys.test.ts — Test Report

> **Test file:** [keys.test.ts](../../../../../../test/storage/keys.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [keys.ts.md](../../../../implementation/source/src/storage/keys.ts.md)

## Overview

Use real fork hashes and zero/positive heights; output equals the original colon-joined representation and separates coordinates.

## Tests and covered test IDs

| Test declaration                                                                                                              | Covers                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`coordinateKey > preserves zero-height coordinates`](../../../../../../test/storage/keys.test.ts#L6) (line 6)                | [`UNIT-TEST-KEYS-32-FMYDFT.P1`](../../../../implementation/source/src/storage/keys.ts.md#unit-test-keys-32-fmydft.p1) |
| [`coordinateKey > separates positive heights and fork identities`](../../../../../../test/storage/keys.test.ts#L10) (line 10) | [`UNIT-TEST-KEYS-32-FMYDFT.P2`](../../../../implementation/source/src/storage/keys.ts.md#unit-test-keys-32-fmydft.p2) |
