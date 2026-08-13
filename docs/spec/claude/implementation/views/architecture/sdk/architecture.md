# SDK Architecture

> **Specification subject:** [specification/architecture/sdk.md](../../../../specification/runtime/sdk.md)

> **Status:** Draft, reverse-engineered baseline. Pending engineer review.
> **Scope:** How the TypeScript SDK is layered, how an application enters it
> (`p2pSetup`), the runtime host/client split, signer ownership, the two local
> state-machine instances, and the component map. The two core algorithms live in
> [block-confirmation-pipeline.md](./block-confirmation-pipeline.md) and
> [dispute-pipeline.md](./dispute-pipeline.md); per-component observable
> contracts live in [components.md](./components.md).

## 1. Purpose & observable contract

The SDK turns an ordinary ethers contract instance into an **enshrined** p2p
contract: calling the returned instance executes the state machine off-chain,
between peers, with the chain as fallback arbiter. One call constructs the whole
runtime:

```ts
const p2p = await EvmStateMachine.p2pSetup(scmProxy, stateMachine, deployStateMachine, options?);
```

The application never touches the internal managers directly. It observes and
drives the runtime only through the returned [`P2pInstance`](../../../../../../../src/evm/P2pInstance.ts#L18)
surface: the enshrined contract, two client-side signers, the `EventBus`, and
`hostRpc`. `getStateManager()` throws by design in every mode.

### 1.1 `p2pSetup` — verified signature

Implemented by [`EvmDiamondStateMachine.p2pSetup`](../../../../../../../src/evm/EvmDiamondStateMachine.ts#L447)
(the class is exported as `EvmStateMachine`).

Parameters:

| Parameter                              | Type                             | Meaning                                                                                                                                                                                                                                      |
| -------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deployedStateChannelContractInstance` | `StateChannelManagerProxy`       | Connected on-chain manager proxy. MUST have a provider attached (`p2pSetup` throws otherwise); that provider is reused by the runtime client for main-thread reads.                                                                          |
| `stateMachineContractInstance`         | `T extends AStateMachine`        | Typed instance of the integrator state machine. Used only for its address + ABI (`SerializedContract`); the enshrined instance is rebuilt from these on the client side, preserving the TypeChain type.                                      |
| `deployStateMachine`                   | `LocalStateMachineDeployer`      | Async deployer `(signer) => address` that deploys one state-machine instance into the local EVM. Called **twice** (§4).                                                                                                                      |
| `options.peerId`                       | `number?`                        | Logger tag only.                                                                                                                                                                                                                             |
| `options.peerLogger`                   | `Logger?`                        | Replaces the default logger.                                                                                                                                                                                                                 |
| `options.config`                       | `Partial<Config>?`               | Runtime config overrides; precedence in [`createConfig`](../../../../../../../src/utils/config.ts#L147) is overrides > `process.env` > `peer3.config.ts` > defaults. See [../reference/configuration.md](../../operations/configuration.md). |
| `options.signerSecret`                 | `string?`                        | Private key (`0x` + 64 hex) or mnemonic. **A random private key is generated when omitted.**                                                                                                                                                 |
| `options.customRpcManifest`            | `CustomRpcManifest?`             | Integrator RPC root, resolved on the host via [`resolveCustomRpcManifest`](../../../../../../../src/rpc/resolveCustomRpcManifest.ts#L1) and typed through [`registry.ts`](../../../../../../../src/rpc/registry.ts#L1).                      |
| `options.customPrecompiles`            | `EvmCustomPrecompileManifest[]?` | Integrator precompiles installed into the local EVM executor.                                                                                                                                                                                |
| `options.handlerExecutionContext`      | `HostHandlerExecutionContext?`   | Wraps every inline-host handler invocation (port messages, incoming p2p RPC). Ignored in threaded mode — a worker runs exactly one peer's host.                                                                                              |

Return: `P2pInstance<T, TCustomRpc>` with members:

| Member                           | Contract                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p2pContractInstance: T`         | Enshrined contract; same interface as the original, calls execute p2p via the runtime port.                                                                                                             |
| `p2pSigner: ClientP2pSigner`     | Client-side p2p signer (block/artifact signing over the port).                                                                                                                                          |
| `chainSigner: ClientChainSigner` | Client-side signer for on-chain transactions; forwarded to the host's nonce-managed wallet.                                                                                                             |
| `stateChannelManagerContract`    | The connected manager proxy (client realm).                                                                                                                                                             |
| `events: EventBus`               | Unified event surface (§5).                                                                                                                                                                             |
| `hostRpc`                        | Typed mirror of the host's `remoteRpc`; no target = loopback to self, peer address = relay.                                                                                                             |
| `webRTCBridgePort`               | Present only when the host runs in a worker that cannot drive `RTCPeerConnection`; must be bubbled to the main thread. `installMainThreadBridgeIfOnMainThread()` is called by `p2pSetup` automatically. |
| `dispose()`                      | Tears down listeners, the runtime, and (threaded mode) the worker.                                                                                                                                      |
| `onHostError(listener)`          | Observes autonomous host-side errors; with no subscriber they re-throw as main-thread unhandled rejections.                                                                                             |
| `quiesce()`                      | Drains host-side detached async work over the port; returns collected rejections.                                                                                                                       |

**Signer ownership (REQ-SDK-1).** The runtime host owns the signing key.
`p2pSetup` accepts only `signerSecret`; injected `ethers.Signer` objects are
intentionally unsupported. The host builds its own `Wallet` on its own provider
([`RuntimeChainContext`](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts#L5))
and wraps it in [`HostNonceManager`](../../../../../../../src/evm/signer/HostNonceManager.ts#L15)
for every on-chain manager send, so concurrent async flows cannot race on the
account nonce. The client realm holds only proxy signers that forward over the
port.

## 2. Layering

Top to bottom:

1. **Application (main thread).** Holds `P2pInstance`; calls the enshrined
   contract, subscribes on `events`, uses `hostRpc` and the client signers.
2. **Runtime client.** [`P2pRuntimeClient`](../../../../../../../src/evm/p2pRuntime/P2pRuntimeClient.ts#L88)
   speaks a request/response protocol over a `RuntimePort` and mirrors bus
   events into the client-realm `EventBus`.
3. **Runtime host.** [`startP2pRuntimeHost`](../../../../../../../src/evm/p2pRuntime/P2pRuntimeHost.ts#L200)
   constructs the live graph: provider + wallet, `Clock` sync, time config from
   the chain (`getAllTimes` → `p2pTime`, `agreementTime`, `chainFallbackTime`,
   `evidenceTime`), the local EVM contract executor, `Storage`, `StateManager`
   and everything it owns (managers, RPC services, transports, event listener).
4. **Local EVM.** A contract executor (optionally in its own thread,
   `VM_DEDICATED_THREAD`) hosting the two deployed state-machine instances and
   the `LocalDiamond` (§4).
5. **Chain.** One WebSocket provider per host, derived from `PROVIDER_URL` (§6).

### 2.1 Host/client split — inline vs worker

`RUN_SDK_IN_THREAD` selects the mode; the port protocol is identical in both:

- **Inline (default).** `createRuntimeChannel()` makes an in-process port pair;
  the host runs on the same thread. `handlerExecutionContext`, when provided,
  wraps every host handler (port messages and `P2PManager.onRpc`) — used by
  hosts embedding several peers in one thread.
- **Worker (`RUN_SDK_IN_THREAD=true`).** `createTransferableChannel()` +
  `createP2pRuntimeWorker()`; a `WorkerBootstrapMessage {type:"connect", payload, port}`
  transfers the port into the worker. `dispose()` shuts the worker down. WebRTC
  cannot run in a worker, so the host mints a bridge `MessageChannel` and posts
  the main-thread end to the client (`webRTCBridgePort`).

Client → host request types (verified in [`P2pRuntimeHost.handleRequest`](../../../../../../../src/evm/p2pRuntime/P2pRuntimeHost.ts#L412)):
deployment bridge (`deploySigner*`, `deployComplete`), chain signer
(`chainSignerSignTransaction/SendTransaction/SignMessage/SignTypedData`),
p2p signer (`signMessage`, `signTypedData`), enshrined-contract execution
(`sendTransaction`, `callView`), channel lifecycle (`connectToChannel`,
`setChannelId`, `joinChannel`, `topUpBalance`, `collectJoinChannelConfirmation`,
`getChannelStatus`, `setIsLeader`, `disconnectFromPeers`), `hostRpc`, `quiesce`,
`dispose`. Host → client messages: `ready`, `response`, `busEvent`,
`hostError`, `webRTCBridgePort`.

Startup sequence: config → resolve signer → start host (inline or worker) →
client connects → `deployStateMachine` runs twice through the deployment
bridge signer → `deployComplete` triggers `buildRuntime` → host posts `ready`
→ `P2pInstance` returned.

## 3. Assumptions, constraints & dependencies

- **RPC observation assumption (REQ-SDK-2).** _Current:_ the SDK observes the
  chain exclusively through the single configured `PROVIDER_URL`. The host
  converts `http(s)` to `ws(s)` and **requires a reachable WebSocket endpoint**
  ([`RuntimeChainContext`](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts#L5)
  throws otherwise). `Clock`, the event listener, event recovery, all local
  validation staticCalls against the manager, and every on-chain send flow
  through this one provider. There is no redundancy and no cross-checking;
  [`ReductionExecutor`](../../../../../../../src/stateManager/reduction/ReductionExecutor.ts#L53)
  documents in code that reduction treats provider failure as fatal. _Intended:_
  redundancy across independent RPC providers reduces availability failures, but
  the trust assumption remains — correct operation is not guaranteed if every
  endpoint is unavailable, dishonest, or malicious. See
  [../security/trust-model.md](../../../../specification/security/trust-model.md).
- The chain is live, honest, and eventually final; `TimeConfig` values fetched
  from the manager are consistent with the deployed contracts
  ([../protocol/time.md](../../../../specification/protocol-model/time.md)).
- The integrator state machine obeys the deterministic execution-context rules
  ([../concepts/state-machines.md](../../../../specification/protocol-model/state-machines.md)); otherwise
  local execution, replay, and fraud proofs diverge.
- One runtime host per signer identity; `createConfig` is process-global and
  intended to be called once per runtime.

## 4. The two local state-machine instances (INV-SDK-3)

`p2pSetup` calls `deployStateMachine` **twice**:

1. **Live instance** — drives the replicated channel state. All happy-path
   execution (`stateTransition`, `getState`/`setState`, `getNextToWrite`,
   balance algebra, `processInboundMessage`) runs against it through
   [`EvmDiamondStateMachine`](../../../../../../../src/evm/EvmDiamondStateMachine.ts#L62).
2. **Diamond instance** — embedded in the locally deployed
   [`LocalDiamond`](../../../../../../../src/evm/EvmDiamondStateMachine.ts#L6) (see
   `deployLocalDiamondWithStateMachineAddress`). The `LocalDiamond` is a local
   mirror of the on-chain manager's dispute/fraud-proof logic plus per-channel
   chain state, kept in sync by the
   [`EventHandler`](../../../../../../../src/eventHandlers/EventHandler.ts#L48) replaying
   observed chain events (`onChannelOpened`, `onStateSnapshotUpdated`,
   `onBlockCalldataPosted`, `onDisputeCommitted`, `onOnChainSlashAdded`, ...).
   Dispute re-execution, replay positioning, and canonical validation
   predicates (`isBlockAuthentic`, `hasInvalidTimestamp`, `reduce`, ...) run
   here so they can never mutate the live replicated state.

The instances MUST stay separate: dispute replay repositions the state machine
at arbitrary historical states; doing that on the live instance would corrupt
the channel state under the working pipeline.

## 5. Event surface

[`EventBus`](../../../../../../../src/events/EventBus.ts#L43) is the one event class on both
sides of the port. It carries three kinds:

| Kind             | Producer                                                                                                          | Payload typing                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `p2pEventHooks`  | Every runtime hook call, via `createBusPublishingHooks` (publish on bus first, then forward to current app hooks) | Derived from `P2pEventHooks` (void hooks only)                                  |
| `eventHandler`   | Mirrored `EventHandler` invocations (`forwardEventHandlerInvocations`)                                            | Derived from `EventHandlerHooks`                                                |
| `contractEvents` | `EvmDiamondStateMachine.processLogs` after a successful transition                                                | `unknown[]`; typing recovered by `attachContractEvents` onto an ethers instance |

Dispatch order per emission: exact-name listeners → kind-wide listeners (both
isolated; one failing listener never blocks others) → the single host-only
**bridge tap**, which posts a `busEvent` over the port and whose failure
propagates to the producer. Contract events are emitted synchronously inside
the transition success path, before the next `onTurn`, and a bridge failure is
logged without failing the transition.

## 6. Component map

```mermaid
flowchart TB
    subgraph Client["Client realm (main thread)"]
        App["Application"]
        PI["P2pInstance<br/>enshrined contract · signers · events · hostRpc"]
        PRC["P2pRuntimeClient"]
        App --> PI --> PRC
    end
    PRC <-- "RuntimePort (inline or worker)" --> Host

    subgraph Host["Runtime host realm"]
        SM["StateManager (hub, mutex)"]
        BQM["BlockQueueManager"]
        VS["ValidationService + strategies"]
        AM["AgreementManager"]
        DM["DisputeManager"]
        DVS["DisputeValidationService"]
        RM["ReductionManager/Executor"]
        SUS["SnapshotUpdateService"]
        EH["EventHandler"]
        ESS["EventSyncService"]
        SCEL["StateChannelEventListener"]
        P2P["P2PManager + RPC services"]
        TR["Transports<br/>Holepunch / WebRTC / Loopback / Local"]
        ST["Storage (per-domain stores)"]
        CLK["Clock"]
        SM --> BQM --> VS
        SM --> AM
        SM --> DM --> DVS
        SM --> RM
        SM --> SUS
        SM --> P2P --> TR
        SM --> ST
        SCEL --> ESS --> EH --> SM
        SM -.-> CLK
    end

    subgraph EVM["Local EVM (optional dedicated thread)"]
        LSM["Live state machine"]
        LD["LocalDiamond + dedicated state machine"]
    end
    SM --> LSM
    VS --> LD
    DVS --> LD
    EH -- "mirror chain events" --> LD

    Chain["Chain via single WebSocket RPC (PROVIDER_URL)"]
    SCEL <-- "logs" --> Chain
    DM -- "uploadDispute / applyFraudProofs" --> Chain
    RM -- "reduceAndFinalize" --> Chain
    SUS -- "updateStateSnapshot*" --> Chain
    SM -- "postBlockCalldata" --> Chain
```

Flow detail: block intake/validation in
[block-confirmation-pipeline.md](./block-confirmation-pipeline.md); dispute
construction/audit/reduction in [dispute-pipeline.md](./dispute-pipeline.md);
per-component contracts in [components.md](./components.md).

## 7. Invariants & failure behavior

- **INV-SDK-1** — All application interaction with the runtime crosses the
  `RuntimePort`; direct state-manager access is disabled in every mode.
- **INV-SDK-2** — The runtime host owns the signing key and the chain nonce;
  no injected signer exists, and every on-chain manager send goes through the
  host's nonce manager.
- **INV-SDK-3** — Dispute re-execution never runs against the live replicated
  state machine (two separate deployments; §4).
- **Failure behavior.** Host construction failures post `hostError` and close
  the port (the client's `ready` settles rejected). A dead client port triggers
  host self-disposal. `StateManager.abort()` (slashed/removed, unrecoverable
  sync failure, fatal reduction error) fires `onAbort`, drops status to
  `OPENED`, and disposes the runtime graph; a code TODO notes that abort does
  not yet tear down the control port, so a disposed peer can still answer host
  RPC queries. **Open question:** is that residual queryability acceptable, or
  must abort also close the runtime port?

## 8. Verification

Concrete test evidence is owned by the downstream verification layer. This section defines implementation-specific obligations only.

### Implementation test plan

These are concrete component-level tests required by the implementation obligations in this document. Exercise public boundaries with real domain values and collaborators. Every listed permutation is required unless an engineer records why it is not applicable.

| Plan item      | Requirement / invariant | Setup and stimulus                                                                                                      | Expected result                                                                                                                | Required permutations                                                                                                                                                                                                                          |
| -------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-SDK-1.T1` | `REQ-SDK-1`             | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | The runtime owns its signer; `p2pSetup` accepts only `signerSecret` (random when omitted), never an injected `Signer`.         | `REQ-SDK-1.T1.P1` — valid case and direct invalid/opposite<br>`REQ-SDK-1.T1.P2` — correct/wrong/missing/duplicate/forged identity or signature and membership boundary<br>`REQ-SDK-1.T1.P3` — before/at/after deadline and maximum honest skew |
| `REQ-SDK-2.T1` | `REQ-SDK-2`             | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | The SDK requires at least one available honest RPC endpoint; current implementation uses exactly one WebSocket `PROVIDER_URL`. | `REQ-SDK-2.T1.P1` — valid case and direct invalid/opposite<br>`REQ-SDK-2.T1.P2` — zero/empty/no-op where meaningful, exact boundary, failure/recovery and relevant race                                                                        |
| `INV-SDK-1.T1` | `INV-SDK-1`             | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | All app↔runtime interaction crosses the runtime port; `getStateManager()` throws.                                             | `INV-SDK-1.T1.P1` — valid case and direct invalid/opposite<br>`INV-SDK-1.T1.P2` — before/at/after deadline and maximum honest skew                                                                                                             |
| `INV-SDK-2.T1` | `INV-SDK-2`             | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | On-chain sends draw nonces from the host-owned nonce manager.                                                                  | `INV-SDK-2.T1.P1` — valid case and direct invalid/opposite<br>`INV-SDK-2.T1.P2` — zero/empty/no-op where meaningful, exact boundary, failure/recovery and relevant race                                                                        |
| `INV-SDK-3.T1` | `INV-SDK-3`             | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Dispute execution uses a dedicated state-machine instance, never the live one.                                                 | `INV-SDK-3.T1.P1` — valid case and direct invalid/opposite<br>`INV-SDK-3.T1.P2` — malformed and adversarial input, partial failure, retry and recovery                                                                                         |

## Future Work

_Non-normative._

- Redundant multi-provider chain observation with cross-checking, and a defined
  degradation mode when providers disagree (see
  [../security/trust-model.md](../../../../specification/security/trust-model.md)).
- Close the runtime port on `abort()` so disposed peers cannot serve host RPC.
- A persistence-backed `Storage` (everything is in-memory today), which would
  change restart/recovery behavior of both pipelines.
- Inject the discovery backend (Holepunch vs local discovery) behind one
  lifecycle API instead of `DEBUG_LOCAL_TRANSPORT` branching.

## Implementation traceability

| Requirement / invariant | Statement                                                                                                                      | Implementation status  | Implementation evidence                                                                                                                                                                                        | Gap / divergence                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `REQ-SDK-1`             | The runtime owns its signer; `p2pSetup` accepts only `signerSecret` (random when omitted), never an injected `Signer`.         | Claimed; audit pending | [src/evm/EvmDiamondStateMachine.ts](../../../../../../../src/evm/EvmDiamondStateMachine.ts#L1), [src/evm/p2pRuntime/RuntimeChainContext.ts](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts#L1) | Engineer audit pending; any divergence named in the evidence remains open. |
| `REQ-SDK-2`             | The SDK requires at least one available honest RPC endpoint; current implementation uses exactly one WebSocket `PROVIDER_URL`. | Claimed; audit pending | [src/evm/p2pRuntime/RuntimeChainContext.ts](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts#L1), [src/utils/config.ts](../../../../../../../src/utils/config.ts#L1)                             | Engineer audit pending; any divergence named in the evidence remains open. |
| `INV-SDK-1`             | All app↔runtime interaction crosses the runtime port; `getStateManager()` throws.                                             | Claimed; audit pending | [src/evm/P2pInstance.ts](../../../../../../../src/evm/P2pInstance.ts#L1)                                                                                                                                       | Engineer audit pending; any divergence named in the evidence remains open. |
| `INV-SDK-2`             | On-chain sends draw nonces from the host-owned nonce manager.                                                                  | Claimed; audit pending | [src/evm/p2pRuntime/P2pRuntimeHost.ts](../../../../../../../src/evm/p2pRuntime/P2pRuntimeHost.ts#L5), [src/evm/signer/HostNonceManager.ts](../../../../../../../src/evm/signer/HostNonceManager.ts#L16)        | Engineer audit pending; any divergence named in the evidence remains open. |
| `INV-SDK-3`             | Dispute execution uses a dedicated state-machine instance, never the live one.                                                 | Claimed; audit pending | [src/evm/EvmDiamondStateMachine.ts](../../../../../../../src/evm/EvmDiamondStateMachine.ts#L1) (`createStandaloneFromLocalStateMachineWithExecutor`, `p2pSetup` double deploy)                                 | Engineer audit pending; any divergence named in the evidence remains open. |
