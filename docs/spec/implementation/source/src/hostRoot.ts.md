# hostRoot.ts

> **Source:** [src/hostRoot.ts](../../../../../src/hostRoot.ts)

No specified behavior: P2P runtime host root API re-exports.

## UNIT-TEST-HOST-ROOT-1-061W5A

Host root entry without the EVM

- Setup: Resolve and load the `host-root` package subpath next to the package index, each in a fresh node process.
- Oracle: The resolved file, the runtime export names and their identity with the index's, the export conditions, and whether the node process holds the `@ethereumjs/evm` package or the EVM factory module that the index reaches.

- [x] `UNIT-TEST-HOST-ROOT-1-061W5A.P1` — the subpath resolves to the built node entry
- [x] `UNIT-TEST-HOST-ROOT-1-061W5A.P2` — the entry exports exactly `P2pRuntimeHostRoot`, the same value as the package index's
- [x] `UNIT-TEST-HOST-ROOT-1-061W5A.P3` — every export condition of the subpath (`types`, `browser`, `node`, `import`, `default`) names the package index's target for that condition with `hostRoot` in place of `index`
- [x] `UNIT-TEST-HOST-ROOT-1-061W5A.P4` — node loading the entry holds no `@ethereumjs/evm` module and no `EvmFactory`
- [x] `UNIT-TEST-HOST-ROOT-1-061W5A.P5` — node loading the package index holds `EvmFactory` (control for P4)
