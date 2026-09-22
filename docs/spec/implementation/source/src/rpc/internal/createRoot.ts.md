# createRoot.ts

> **Source:** [createRoot.ts](../../../../../../../src/rpc/internal/createRoot.ts)
>
> **Replaces:** `src/evm/contractExecutor/types.ts`

## Requirements

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-ROOT-CREATION-1-1NWN3V

Parent-owned root creation

- Setup: Real SDK host creates a production executor root through createRoot.
- Oracle: Each permutation below checks the actual connection and surviving owner.

- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P1` — Inline creation returns after initialization and ready; exact local link, repeated child disposal and SDK owner recovery
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P2` — Worker creation returns after initialization and ready; cross-realm registration, repeated disposal and SDK owner recovery
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P3` — Uncloneable inline startup arguments reject the creation promise, remove the connection and preserve the SDK owner
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P4` — Uncloneable worker startup arguments reject the creation promise, release the waiting worker and preserve the SDK owner
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P5` — Worker failure before the error funnel rejects ready with the original error, removes the failed child and permits another child on the same SDK owner
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P6` — Real SDK creation builds a local top-level root, attaches an inline child, retains ready state and reports top-level errors to the application while later calls succeed
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P7` — The same top-level creation path attaches a worker child with retained ready state and application error handling
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P8` — Missing worker URL rejects creation, removes its owned connection and leaves SDK requests usable
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P9` — Standalone executor loading completes before return, waits for actual delayed precompile initialization and creates no parent connection or automatic child
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P10` — A missing precompile export rejects standalone creation, unregisters the partial root and preserves another SDK
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P11` — Untyped worker-without-parent creation rejects before root allocation; compile-time calls reject the same invalid placement
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P12` — Client communication starts first and retains the same host connection record; application setup stays pending through a held deployment and deploys two distinct contracts before returning the app instance
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P13` — First deployment failure rejects with the original error and removes client/child connections and registered roots
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P14` — Second deployment failure after the first completed rejects with the original error and removes client/child connections and registered roots
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P15` — An actual root observation callback throws during client initialization; common cleanup removes the root and started children and preserves the original error
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P16` — Holding the real inline host ready frame keeps outer client setup pending until the frame is released
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P17` — Holding the real worker host ready frame keeps outer client setup pending until the frame is released
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P18` — Standalone broker loads its provider, has no parent connection, rejects missing callback recipient before creating a native peer and cleans up
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P19` — Worker bridge creation rejects missing local factory and broker port before allocating a root
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P20` — Host observation failure before parent attachment preserves the original error and unregisters the partial host and client roots
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P21` — Parented inline client requires no application objects, has a usable host and reciprocal parent connection, and replies to disposal before closing it; the parent remains usable
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P22` — Missing client connection options reject before any root is registered
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P23` — Inline child creation during and after parent disposal rejects before allocation
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P24` — Worker child creation during and after parent disposal rejects before allocation
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P25` — Parent closure during held inline initialization rejects creation and releases the child without affecting its owner
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P26` — Parent closure after readiness automatically disposes the child and releases its relationship
