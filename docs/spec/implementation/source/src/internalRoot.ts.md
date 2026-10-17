# internalRoot.ts

> **Source:** [src/internalRoot.ts](../../../../../src/internalRoot.ts)

No specified behavior: Internal root API re-exports.

## UNIT-TEST-INTERNAL-ROOT-1-ZDDYFP

Service-only worker entry

- Setup: Resolve and load the `internal-root` package subpath next to the package index, in a fresh node process and in a fresh browser module worker that counts WASM before it imports.
- Oracle: The resolved file, the runtime export names and their identity with the index's, the modules the node process holds, and the WASM instances and memories the browser worker creates.

- [x] `UNIT-TEST-INTERNAL-ROOT-1-ZDDYFP.P1` — the subpath resolves to the built node entry
- [x] `UNIT-TEST-INTERNAL-ROOT-1-ZDDYFP.P2` — the entry exports exactly `AInternalRpcMethods`, `AInternalRpcRoot`, `AInternalRpcService`, `createRoot` and `startRootWorker`, each the same value as the package index's
- [x] `UNIT-TEST-INTERNAL-ROOT-1-ZDDYFP.P3` — node loading the entry holds no P2P runtime host, `P2PManager`, `Holepunch`, relay, hyperswarm or sodium module
- [x] `UNIT-TEST-INTERNAL-ROOT-1-ZDDYFP.P4` — node loading the package index holds the relay (control for P3)
- [x] `UNIT-TEST-INTERNAL-ROOT-1-ZDDYFP.P5` — a browser worker importing the entry creates no WASM instance or memory, while one importing the relay module the index reaches creates at least one memory
