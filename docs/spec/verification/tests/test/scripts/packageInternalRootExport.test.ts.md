# packageInternalRootExport.test.ts

Test file: [test/scripts/packageInternalRootExport.test.ts](../../../../../../test/scripts/packageInternalRootExport.test.ts)

## Overview

The suite checks the `internal-root` package subpath through the package self-reference: where it
resolves, that its runtime exports are exactly the internal root API and the same values as the
index's, and, in a fresh node process each, which modules the entry and the index load. The entry
must load no P2P runtime host, relay, hyperswarm or sodium module; the index must load the relay,
which shows the probe sees them.

## Tests

- `resolves the internal-root subpath to the built entry`: UNIT-TEST-INTERNAL-ROOT-1-ZDDYFP.P1
- `exports exactly the internal root API, as the same values as the package index`: UNIT-TEST-INTERNAL-ROOT-1-ZDDYFP.P2
- `loads neither the P2P runtime host nor its relay`: UNIT-TEST-INTERNAL-ROOT-1-ZDDYFP.P3
- `loads the P2P runtime host and its relay through the package index`: UNIT-TEST-INTERNAL-ROOT-1-ZDDYFP.P4
