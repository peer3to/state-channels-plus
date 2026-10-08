# resolveRuntimeModulePath.test.ts

Test file: [test/utils/resolveRuntimeModulePath.test.ts](../../../../../../test/utils/resolveRuntimeModulePath.test.ts)
Exercises: [resolveRuntimeModulePath.ts](../../../../implementation/source/src/utils/moduleLoader/node/resolveRuntimeModulePath.ts.md)

## Overview

Black-box test of the `.ts`/`.js` twin resolution over a temporary directory holding chosen
pairs: an existing file is returned as named, a missing file resolves to its existing twin in
either direction, and a missing pair, a bare package specifier and a non-module extension pass
through unchanged.

## Tests

- `returns the named file when it exists, the twin when only the twin exists, and the input otherwise`: UNIT-TEST-RESOLVE-RUNTIME-MODULE-PATH-1-K3M8QD.P1
