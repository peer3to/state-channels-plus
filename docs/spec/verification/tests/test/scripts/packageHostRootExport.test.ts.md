# packageHostRootExport.test.ts

Test file: [test/scripts/packageHostRootExport.test.ts](../../../../../../test/scripts/packageHostRootExport.test.ts)
Exercises: [hostRoot.ts](../../../../implementation/source/src/hostRoot.ts.md)

## Overview

The suite checks the `host-root` package subpath through the package self-reference: where it
resolves, that its one runtime export is the index's `P2pRuntimeHostRoot`, that its export
conditions mirror the index's, and, in a fresh node process each, whether the entry and the index
load the EVM. The entry must load neither `@ethereumjs/evm` nor `EvmFactory`; the index must load
`EvmFactory`, which shows the probe sees it.

## Tests

- `resolves the host-root subpath to the built entry`: UNIT-TEST-HOST-ROOT-1-061W5A.P1
- `exports exactly the host root, as the same value as the package index`: UNIT-TEST-HOST-ROOT-1-061W5A.P2
- `mirrors the package index's export targets for every condition`: UNIT-TEST-HOST-ROOT-1-061W5A.P3
- `loads no EVM`: UNIT-TEST-HOST-ROOT-1-061W5A.P4
- `loads the EVM factory through the package index`: UNIT-TEST-HOST-ROOT-1-061W5A.P5
