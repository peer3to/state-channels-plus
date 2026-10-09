# RootCreation tests

Test file: [RootCreation.test.ts](../../../../../../test/rpc/RootCreation.test.ts)
Exercises: [createRoot](../../../../implementation/source/src/rpc/internal/createRoot.ts.md)

## Overview

The worker creation fixture uses an explicit test entry whose class name differs from the requested root class. It verifies the supplied threadName before initialization; importing another root stays inert. Both placements preserve the parent thread name.

Uses [root creation staging](../../../../../../test/fixtures/RootCreationFixture.ts) and [worker failure staging](../../../../../../test/fixtures/node/RootCreationStaging.ts) to create real executor children on a genuine SDK host. Checks connection-before-ready, placement, repeated disposal, actual startup clone failures and owner isolation.

The parentless-worker cases ([ParentlessRootCreationFixture](../../../../../../test/fixtures/node/ParentlessRootCreationFixture.ts)) create real contract-executor workers through `createRoot` with `mode: "worker"` and no parent, using the probe executor entry, and observe the hidden parent through the test-only `RootCreationControl`. Oracles: the parent's class and its single child, cross-realm handle, real probe sums and the worker thread name, parent identity across creations, the handle's closed state, and the parent's disposing flag and empty connection map after disposal or after a startup failure caused by a missing precompile module. The crash case loads [workerAnswerPrecompile](../../../../../../test/fixtures/workerAnswerPrecompile.ts) with an `exitCode`, so the worker thread exits during a real `executeCall`; it waits for the handle to close, reads the call's rejection and the parent's not-yet-disposing flag, then disposes the handle and reads the same released state. The inline-owner case runs two inline SDK runtimes in one realm with a custom RPC ([OwnerContextRpcManifest](../../../../../../test/fixtures/customRpc/OwnerContextRpcManifest.ts)) that creates a real executor child under the owner it receives and records whether that host had stored its runtime yet; it compares actual host instances, child registration, and which child survives disposal of the second runtime. Both child placements also preserve the caller's Buffer, global and window state. The crashed-worker case asserts the handle's recorded failure and the call's rejection are both `Root worker exited with 31`, and, with no listener on the handle, that the hidden parent logged exactly that cause into the caller's log store; a second crashed-worker case registers `handle.onError` and asserts the listener received exactly that error while the hidden parent logged nothing. The logger case creates a parentless worker with a real caller logger, has the worker report an error through the probe and finds it in the caller's store, then disposes the handle and asserts the caller's logger is not disposed and still stores new entries.

## Tests

- `settles disposal when the worker exits before its acknowledgement`: UNIT-TEST-ROOT-ERROR-1-0N4XM4.P6, REQ-RUNTIME-3-VQXW59.T1.P50
- `rejects inline child creation during and after parent disposal`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P23
- `rejects worker child creation during and after parent disposal`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P24
- `rejects missing client connection options before allocating a root`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P22, REQ-RUNTIME-3-VQXW59.T1.P43
- `connects a parented inline client without application objects and acknowledges disposal`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P21, REQ-RUNTIME-3-VQXW59.T1.P42
- `cleans a host root when observation fails before parent attachment`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P20, REQ-RUNTIME-3-VQXW59.T1.P39
- `initializes a standalone WebRTC broker and requires a callback recipient`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P18
- `rejects a worker bridge without its required local factory and broker port`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P19
- `cleans roots when client initialization observation fails`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P15, REQ-RUNTIME-3-VQXW59.T1.P36
- `waits for a held inline host ready notification during client initialization`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P16, REQ-RUNTIME-3-VQXW59.T1.P37
- `waits for a held worker host ready notification during client initialization`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P17, REQ-RUNTIME-3-VQXW59.T1.P38
- `initializes a standalone executor before returning without parent connections`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P9, REQ-RUNTIME-3-VQXW59.T1.P30, UNIT-TEST-ROOT-DISPOSAL-1-NMS66W.P7
- `cleans a standalone executor after initialization fails`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P10, REQ-RUNTIME-3-VQXW59.T1.P31
- `creates a parentless worker whose typed handle serves calls in the worker`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P27, REQ-RUNTIME-3-VQXW59.T1.P64
- `gives each parentless worker its own hidden parent`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P28, REQ-RUNTIME-3-VQXW59.T1.P65
- `releases a parentless worker's hidden parent and connection when its handle is disposed`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P29, REQ-RUNTIME-3-VQXW59.T1.P66
- `releases a parentless worker's hidden parent when worker startup fails`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P30, REQ-RUNTIME-3-VQXW59.T1.P67
- `releases a crashed parentless worker's hidden parent when its handle is disposed`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P33, REQ-RUNTIME-3-VQXW59.T1.P82
- `keeps one parentless worker serving after another is disposed`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P31, REQ-RUNTIME-3-VQXW59.T1.P68
- `keeps a live parentless worker serving when another worker's startup fails`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P32, REQ-RUNTIME-3-VQXW59.T1.P69
- `passes each inline peer's exact host to its custom RPC before readiness and keeps peers isolated`: UNIT-TEST-P2P-RUNTIME-HOST-34-517JAX.P1, REQ-RUNTIME-3-VQXW59.T1.P70
- `returns encoded deployment call data through a real SDK worker`: UNIT-TEST-DEPLOY-SIGNER-CALL-1-2B0R11.P2
- `keeps application setup pending through two independent deployments after client communication is ready`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P12, REQ-RUNTIME-3-VQXW59.T1.P33, UNIT-TEST-DEPLOY-SIGNER-CALL-1-2B0R11.P1
- `cleans client and child roots when the first deployment fails`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P13, REQ-RUNTIME-3-VQXW59.T1.P34
- `cleans client and child roots when the second deployment fails`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P14, REQ-RUNTIME-3-VQXW59.T1.P35
- `rejects worker creation without an entry URL and keeps the SDK usable`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P8
- `creates the local top-level root and its inline SDK child through the free function`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P6
- `creates the local top-level root and its worker SDK child through the free function`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P7, UNIT-TEST-NODE-HOST-URL-1-FQB5X6.P1
- `preserves a startup failure and creates another worker child on the same SDK owner`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P5, REQ-RUNTIME-3-VQXW59.T1.P29
- `returns an initialized inline child and preserves its SDK owner`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P1, REQ-RUNTIME-3-VQXW59.T1.P25, UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P3
- `returns an initialized worker child and disposes it through its SDK owner`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P2, REQ-RUNTIME-3-VQXW59.T1.P26, UNIT-TEST-REMOTE-ROOT-1-7D9JVE.P4
- `rejects uncloneable inline startup arguments without leaking a connection`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P3, REQ-RUNTIME-3-VQXW59.T1.P27
- `rejects uncloneable worker startup arguments and releases the waiting worker`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P4, REQ-RUNTIME-3-VQXW59.T1.P28
- `cleans an inline child when its parent connection closes during startup`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P25
- `disposes an initialized inline child when its parent connection closes`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P26
- `reports a crashed parentless worker's exit cause to its handle's error listener`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P35
- `borrows a caller's logger for a parentless worker and leaves it usable after disposal`: UNIT-TEST-ROOT-CREATION-1-1NWN3V.P34

The creation type fixture rejects direct afterDispose assignment: callers must install cleanup through setAfterDispose. It also compiles `local` for an inline child and for a placement chosen at runtime, and expects a compile error for `local` on a known worker child. These type checks are not executable declarations and are credited to no permutation.
