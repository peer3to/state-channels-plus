# createRoot.ts

> **Source:** [createRoot.ts](../../../../../../../src/rpc/internal/createRoot.ts)
>
> **Replaces:** `src/evm/contractExecutor/types.ts`

## Requirements

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg)
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- [`REQ-CONFIG-4-WW7BRX` (Isolated contexts start with their creator's configuration)](../../../../../specification/runtime/configuration.md#req-config-4-ww7brx)

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
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P27` — A parentless worker creation returns a typed handle whose calls run in the worker; one hidden `ParentlessWorkerParentRoot` is observed, holds exactly that handle as its only child, and the handle is cross-realm
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P28` — Two parentless worker creations observe two distinct hidden parents and both workers serve calls
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P29` — Disposing a parentless worker's handle closes it, leaves its hidden parent disposing with no connections, and a repeated disposal keeps that state
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P30` — A parentless worker whose startup fails rejects creation and leaves its hidden parent disposing with no connections
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P31` — Disposing one of two parentless workers releases only its hidden parent; the other parent stays live and its worker keeps serving
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P32` — A failed parentless creation while another parentless worker is live releases only the failed creation's distinct hidden parent; the live worker keeps serving
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P33` — A parentless worker whose thread exits during a real call rejects that call and closes its handle while its hidden parent is not yet disposing; disposing the handle afterwards leaves the hidden parent disposing with no connections
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P34` — A parentless worker created with a caller logger reports its errors through a child of that logger into the caller's store; disposing the handle leaves the caller's logger undisposed and usable
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P35` — A parentless worker whose thread exits while its handle has an error listener delivers exactly the exit cause to that listener, rejects the pending call with it, and the hidden parent does not log it
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P36` — A worker root created after the creating thread changed its config already holds that config when its root class is constructed; no root installs a config itself
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P37` — A parentless worker root that installs no config itself uploads a line it logged to the endpoint that only the creating thread's config names, under the thread name its entry passed to `startRootWorker`
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P38` — A worker root whose entry passes no thread name to `startRootWorker` logs and uploads under `main`
- [x] `UNIT-TEST-ROOT-CREATION-1-1NWN3V.P39` — In a browser worker, `startRootWorker` with a thread name gives the root's logger that name, and without one gives it `main`
