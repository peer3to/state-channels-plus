# test/utils/resolveRuntimeModulePath.test.ts — Test Report

> **Test file:** [test/utils/resolveRuntimeModulePath.test.ts](../../../../../../test/utils/resolveRuntimeModulePath.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [resolveRuntimeModulePath.ts](../../../../implementation/source/src/utils/moduleLoader/node/resolveRuntimeModulePath.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Black-box test of the `.ts`/`.js` twin resolution over a temporary directory holding chosen
pairs: an existing file is returned as named, a missing file resolves to its existing twin in
either direction, and a missing pair, a bare package specifier and a non-module extension pass
through unchanged.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                   | Covers                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: resolveRuntimeModulePath > returns the named file when it exists, the twin when only the twin exists, and the input otherwise`](../../../../../../test/utils/resolveRuntimeModulePath.test.ts#L8) (line 8) | [`UNIT-TEST-RESOLVE-RUNTIME-MODULE-PATH-1-K3M8QD.P1`](../../../../implementation/source/src/utils/moduleLoader/node/resolveRuntimeModulePath.ts.md#unit-test-resolve-runtime-module-path-1-k3m8qd) |
