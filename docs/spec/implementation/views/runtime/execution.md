# Runtime Isolation and Concurrency — Implementation

> **Specification subject:** [specification/runtime/execution.md](../../../specification/runtime/execution.md)

## RPC ownership

Internal roots and service pairs are centralized under `src/rpc/internal`. `AInternalRpcRoot` owns one runtime router and its connections; each service retains its domain dependencies. All routers live under `src/rpc/router`. Each peer manager owns a separate NetworkRpcRouter; the manager itself owns connections, discovery, profiles and peer penalties. Both categories use shared dispatch and pending settlement, with typed category-specific transports.

## System design

Each SDK endpoint owns one root across its connections. The host root owns executor connections;
both inline and dedicated execution use the same facade over a local MessageChannel or worker port.
The receiving executor service owns EVM initialization and delegates serialization to the canonical
engine mutex. Inline executor disposal releases the engine and closes the connection, just as worker disposal does.

Shared request settlement, endpoint dispatch and proxy payload construction each have one owner.
Network transports retain JSON encoding, peer identity and admission. Internal transports use
structured clone and explicit transfer lists. Runtime service boundaries prepare domain errors;
the shared router carries those prepared values without selecting codecs by transport or method.

Logger services share local store registration while each root retains its own service instance.
Each LoggerService reads its root’s parent and child connections. An upload triggers its attached stores and gossips through those connections; upload indices and the coalescing window suppress repeated work.

Consumers extend the runtime with their own roots under an exact local owner. The host passes itself
as `{ owner: this }` through `StateManager` and `P2PManager` to the custom-RPC constructor while it is
still building its runtime; the executor passes its own root (`router.rpcRoot`) through `createEvm` to
custom precompile factories during executor startup. Neither reference leaves its realm or enters a
manifest. Several inline runtimes in one realm therefore parent their consumers' children on distinct
hosts, and each owner's recursive disposal cascades only to its own children. A consumer without an owner
creates a parentless worker: `createRoot` builds one hidden, service-less parent for that worker alone in
the caller realm and disposes it after the worker handle's own cleanup, or when startup fails. Executor
disposal first closes admission to deploy, call, and simulation and waits for every admitted operation,
including ones queued on the engine mutex, before its children close. The drain is bounded by
`IN_FLIGHT_REPLY_DRAIN_MS`, the same five-second limit as the root's in-flight reply drain: work still
admitted at the limit is abandoned inside the executor service with a debug log, every caller still
waiting receives the disposal rejection, children then close, and the operation's later success or
failure is dropped, so it never replaces that rejection and no error reaches the host
([`OQ-IMPL-EXECUTOR-DRAIN-1-5D71YM` (Resolved executor admission drain bound)](../../open-questions.md#oq-impl-executor-drain-1-5d71ym)).
The generic root bases and creation functions are public SDK exports; the concrete SDK roots are not.

The following concrete reports explain the current design:

- [ARpcRouter.ts](../../source/src/rpc/router/ARpcRouter.ts.md)
- [RpcDispatch.ts](../../source/src/rpc/RpcDispatch.ts.md)
- [createRpcProxy.ts](../../source/src/rpc/createRpcProxy.ts.md)
- [InternalRpcRouter.ts](../../source/src/rpc/router/InternalRpcRouter.ts.md)
- [AInternalRpcRoot.ts](../../source/src/rpc/internal/AInternalRpcRoot.ts.md)
- [NetworkTransport.ts](../../source/src/transport/NetworkTransport.ts.md)
- [InternalTransport.ts](../../source/src/transport/InternalTransport.ts.md)
- [P2pRuntimeHostRoot.ts](../../source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md)
- [P2pRuntimeClientRoot.ts](../../source/src/rpc/internal/roots/P2pRuntimeClientRoot.ts.md)
- [ContractExecutorRoot.ts](../../source/src/rpc/internal/roots/ContractExecutorRoot.ts.md)
- [LoggerService.ts](../../source/src/rpc/internal/services/logger/LoggerService.ts.md)
- [createRoot.ts](../../source/src/rpc/internal/createRoot.ts.md)
- [RemoteRoot.ts](../../source/src/rpc/internal/RemoteRoot.ts.md)
- [ContractExecutorService.ts](../../source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md)
- [ContractExecutorRpcMethods.ts](../../source/src/rpc/internal/services/contractExecutor/ContractExecutorRpcMethods.ts.md)
- [EvmFactory.ts](../../source/src/evm/EvmFactory.ts.md)
- [registry.ts](../../source/src/rpc/network/registry.ts.md)
- [RootWorkerRuntime.ts](../../source/src/rpc/internal/node/RootWorkerRuntime.ts.md)

- [architecture/sdk/runtime-and-concurrency.md](../architecture/sdk/runtime-and-concurrency.md)

They are implementation evidence under this subject, not independent specifications.

## INTEGRATION-TEST-RUNTIME-1-G147DN

- Specification: [`INV-RUNTIME-1-AKRHAK` (Execution equivalence)](../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../specification/runtime/execution.md#req-runtime-4-b0n70y)
- Specification tests: All applicable specification permutations
- Setup: Exercise the complete concrete subsystem through each documented entry and failure boundary.
- Oracle: The subsystem preserves the neutral behavior and contains failure without partial state.

- [ ] `INTEGRATION-TEST-RUNTIME-1-G147DN.P7` — boundary integration. Root creation and startup failure: [RootCreation cases](../../../verification/tests/test/rpc/RootCreation.test.ts.md)
