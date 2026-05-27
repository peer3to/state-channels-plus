# W5 — compose with boss's evm-in-thread PR (seam, not impl)

source of truth: `test/harness/threaded/actions/meeting_notes/summary.txt` (may 26).
related: `docs/parallel-plan-v2/master-plan.md`, `docs/parallel-plan-v2/W0-cross-cutting-decisions.md` (D-7, D-10).

**boss's evm-in-thread PR is not yet landed.** this doc designs the SEAM. concrete integration is a follow-up once the PR is in. resist designing boss's PR for him.

---

## what boss already built (reconstructed from the transcript)

paraphrased from the may 26 meeting — names and shapes are illustrative, not ratified. the four facts the seam depends on:

- **the executor split exists.** today's contract executor surface becomes polymorphic with two variants: an in-process variant (current path, unchanged) and a worker-backed variant. [placeholder for boss's chosen names]
- **a factory chooses between them.** boss's words: "the factory, if you take a look here, depending on ... is it a dedicated thread, goes and creates one inline contract executor, and the one, the other one is worker contract executor, which calls create". one boolean drives the branch.
- **boolean opt-in, default off.** "i expose a dedicated config flag of do you want a dedicated thread for the EVM? i don't force it, it's optional."
- **request/response correlated by id.** "from the perspective of the usage, it's the same. it's indifferent." caller awaits a promise parked under a request id; the worker variant ships the request out and resolves on response.

implication for our plan: the executor split lives **inside** a peer's setup path. callers of the executor do not change shape.

---

## the seam this plan exposes

we only need to expose **one thing**: the harness can pass boss's boolean (name tbd) through to whatever setup entry point boss exposes, regardless of whether the peer is inline or worker.

```
                   harnessConfig
                   ├── dedicatedPeerThread          (this plan, W1/W2)
                   └── <boss's evm boolean, name tbd>   (passed through verbatim)

inline peer  ── p2pSetup({ <boss's boolean> }) ──> boss's factory ──> inline | worker executor
worker peer  ── p2pSetup({ <boss's boolean> }) ──> boss's factory ──> inline | worker executor
                  (inside the peer worker)
```

key points:

- a peer-in-worker (W2) constructs its worker-backed executor **exactly the same way** an inline peer does — by calling boss's factory through whatever entry point boss ships. no orchestration on our side. [placeholder for boss's chosen names]
- the two booleans are independent and compose. four combinations all work, tabulated below. 2N+1 (D-7) is just the all-on row.
- this plan does **not** know what the worker-backed executor does internally. that is boss's abstraction.

| peer backend | evm backend | result                                                             |
| ------------ | ----------- | ------------------------------------------------------------------ |
| inline       | inline      | today's path; nothing new                                          |
| inline       | worker      | boss's executor split alone; no peer thread split                  |
| worker       | inline      | this plan's peer thread split alone; evm stays in-process per peer |
| worker       | worker      | both knobs on; 2N+1 (D-7)                                          |

---

## what this plan does NOT do

- **no `PortEip1193Provider`.** chain reads / writes flow through boss's executor abstraction. delete the v1 module.
- **no `ChainBridge`.** same reason. delete.
- **no `PortJsonRpcProvider`.** no separate chain provider for workers. delete.
- **no harness-side message routing for evm requests.** the executor handles its own boundary. boss's worker-backed executor talks to its own evm sub-worker via boss's wire; our MessagePort (D-2) carries orchestration only.
- **no separate chain-instance manager on the harness.** chain instance lifecycle is boss's call inside his executor — we record what he ships and add nothing. we do not speculate about hardhat sharing strategy here.

if any of these modules survive in v1 branches, they get deleted when boss's PR lands. see "what to delete" at the bottom.

---

## confirmation checklist (answers from PR 339)

PR 339 ("dedicated evm thread and esm/commonjs (browser/node) build", commit 77bd0b14) is landed on `master`. answers below from reading the code; cite file:line.

1. **factory reachability.** -> `createContractExecutorFactory({ dedicatedThread, customPrecompiles, logger })` in `src/evm/contractExecutor/ContractExecutorFactory.ts:16`. callers do NOT touch it directly; `EvmDiamondStateMachine.createStandalone` reads `activeConfig.VM_DEDICATED_THREAD` and constructs the executor (`src/evm/EvmDiamondStateMachine.ts:374`). so the seam for OUR harness is the existing `p2pSetup` callsite with a `config: { VM_DEDICATED_THREAD: true }` override.
2. **worker-side executor inside a node worker_thread.** -> the EVM worker is spawned via `node:worker_threads.Worker` from `src/evm/contractExecutor/node/ContractExecutorWorkerRuntime.ts:13`. nothing prevents this from running inside another worker (worker_threads nest). not observed end-to-end yet because of (3) below.
3. **hardhat chain instance.** -> **NOT addressed by PR 339.** boss's PR splits ONLY the LOCAL EVM (`LocalDiamond` in-memory simulator). the on-chain `StateChannelManagerProxy` access (chain reads via `Clock.init(signer.provider)`, `getAllTimes`, event listener `stateChannelManagerContract.on(filter, ...)`) still happens on the **main thread's signer**. there is no chain-access plumbing for a peer running inside a worker_thread. **this is a real blocker for `dedicatedPeerThread=true` against hardhat-in-process.** see "what remains blocked" below.
4. **boolean forwarding callsites.** -> ONE callsite. `src/utils/config.ts:16` declares `VM_DEDICATED_THREAD: boolean`. `src/evm/EvmDiamondStateMachine.ts:502` reads `activeConfig.VM_DEDICATED_THREAD` and passes to `createStandalone`. user opts in via `p2pSetup({ config: { VM_DEDICATED_THREAD: true } })` or env `VM_DEDICATED_THREAD=true`.
5. **error reporting surface.** -> rejections come through the existing executor promise (`WorkerContractExecutor.handleResponse`, `src/evm/contractExecutor/WorkerContractExecutor.ts:140`). worker exit with non-zero code -> `rejectAll(new Error("Contract executor worker exited with N"))`.

## what remains blocked

PR 339's executor split is **necessary but not sufficient** for `dedicatedPeerThread=true`. the gap is chain access from inside a peer worker:

- a peer in worker mode needs `EvmStateMachine.p2pSetup` to receive a `Signer` with a working `Provider`. today's tests use `hre.ethers.getSigners()` which returns `HardhatEthersSigner`s backed by the in-process hardhat instance. provider object refs cannot cross thread boundaries.
- two possible paths forward (record; don't choose for boss):
    - (a) **HTTP-served hardhat**: run hardhat as `hardhat node` (HTTP RPC on 127.0.0.1:N), workers construct `new ethers.JsonRpcProvider(url)` + `Wallet.connect(provider)`. requires test-infra change (separate process or `network.provider.send("hardhat_*")` patterns won't help).
    - (b) **chain proxy over MessagePort**: orchestrator forwards chain calls back to its `hre.ethers.provider`. this is the v1 `PortJsonRpcProvider` approach boss explicitly told us NOT to build because his executor was meant to own the chain boundary. it appears his executor does NOT own that boundary; the v1 stack may need to come back, scoped narrower (chain only, not local EVM).
- our wire-through ships the SEAM (worker entry takes `chainProviderUrl`, constructs `JsonRpcProvider` + `Wallet.connect`, calls `p2pSetup` against it) but the orchestrator currently has no URL to supply, so spawn args set `chainProviderUrl = undefined` and the worker stops after `boot`. unblocking the 2-peer threaded smoke requires path (a) or (b) above.

---

## questions to confirm with boss

- what are the class names for the polymorphic executor and the factory function once boss's PR lands? does the abstract surface stay named `ContractExecutor`, or get renamed? [placeholder for boss's chosen names]
- where does the boolean live — `EvmStateMachine.p2pSetup` opts, a top-level SDK config, or both?
- how does a peer-in-worker reach the factory — direct import inside the worker bundle (browser/node split per the bundler change boss mentioned), or threaded through `p2pSetup` opts?
- assumption: the polymorphic executor he described handles its own chain access; the harness passes no chain handle through. confirm.
- any startup ordering between the peer's `p2pSetup` and its evm sub-worker becoming ready that we should surface as a barrier (W4)?
- how does the per-build split (browser entry vs node entry) interact with worker_thread spawn — do peer workers always pick the node bundle?

---

## what to delete from v1 when boss's PR lands

(rationale-only; concrete paths exist in the v1 branches. non-exhaustive — anything else built to give a worker peer a chain handle outside boss's executor falls under this list.)

- `test/harness/threaded/chain/PortEip1193Provider.ts` — boss owns chain access through the executor.
- `test/harness/threaded/chain/ChainBridge.ts` (and any "chain bridge" router/server) — same reason.
- `test/harness/threaded/chain/PortJsonRpcProvider.ts` — same reason.
- `test/harness/threaded/chain/ChainRpcMethods.ts` and `test/harness/threaded/chain/types.ts` — chain-only rpc surface and types built only for the bridge stack.
- any `*ChainProviderShim`, `*RpcAdapter` modules built to give worker peers a chain handle — boss's executor renders them moot.
- any second rpc kernel built only for chain/evm calls (e.g. an `EvmRpcKernel`, `WorkerEvmBridge`, etc.) — exactly the kind of thing boss's PR makes redundant. confirm none survives.
- any `EvmHandle` / `EvmAdapter` / `ChainHandle` wrappers added on the worker side to ferry chain calls — boss's executor is the only chain handle a peer worker needs.
- the `chainProviderFactory` option threaded through `EvmStateMachine.p2pSetup` in the v1 attempt (if it exists) — replaced by boss's boolean (name tbd).
- harness-level `chainPort` field on the worker entry / `PeerWorker` channels payload (`test/harness/threaded/worker/entry.ts` + `test/harness/threaded/worker/types.ts`) — no chain port over orchestration MessagePort.
- the `chainBridge` field on `ThreadedHarness` (`test/harness/threaded/ThreadedHarness.ts`) and the constructor argument on `ThreadedLifecycleActions` (`test/harness/threaded/actions/ThreadedLifecycleActions.ts`) — harness has no chain plumbing.
- chain-related exports from `test/harness/threaded/index.ts` (`ChainBridge`, `PortEip1193Provider`, `PortJsonRpcProvider`).
- `__tests__` covering any of the above: `test/harness/threaded/chain/__tests__/ChainBridge.test.ts`, plus the `ChainBridge` setup in `test/harness/threaded/worker/__tests__/PeerWorker.test.ts`, `test/harness/threaded/__tests__/ThreeWorkerSmoke.test.ts`, `test/harness/threaded/events/__tests__/EvtFifoContract.test.ts`, `test/harness/threaded/guard/__tests__/LoopGuard.test.ts`.

retain (still useful):

- the **shape** of the rpc kernel (W3) — boss's request/response by id is the same pattern, applied at a different layer. shapes can be aligned but the two channels stay distinct (harness↔peer-worker vs peer↔evm-worker).
- `DeploymentRegistry` concept (W2) — peer workers still need contract addresses + abis to construct their state-machine view; orthogonal to the executor split.

---

## summary

W5 is a passthrough. one boolean forwarded from our harness config through our existing `p2pSetup` callsite; whatever name boss picks on his side is what we read. identical wiring from inline and worker peer backends. boss's PR owns the executor split, the request/response wire, and the chain boundary. when his PR lands: confirm the five items above, delete the v1 chain-bridge stack, ship.

---

## Revision log (round 1 review)

- rewrote "pre-condition checklist" as a "confirmation checklist" -> each item is a `confirm with boss` question; stripped "(b) is the cleaner outcome" and "one knob, two callsites" prescriptions.
- stripped `InlineContractExecutor` / `WorkerContractExecutor` from "what boss already built" and "questions to confirm with boss" -> replaced with `[placeholder for boss's chosen names]` and phrased questions about "the polymorphic executor he described" without locking names.
- "what this plan does NOT do" item on chain-instance manager -> dropped the hardhat-sharing speculation; states refusal without guessing boss's posture.
- "questions" item 4 -> rephrased the chain-handle question as an explicit assumption to confirm rather than an open question.
- summary -> dropped `harnessConfig.dedicatedEvmThread` / `EvmStateMachine.p2pSetup` as if final; references our existing callsite and "whatever name boss picks on his side."
- seam diagram + intro -> replaced `dedicatedEvmThread` with `<boss's evm boolean, name tbd>`; dropped `EvmStateMachine.p2pSetup(...)` as the assumed entry point.
- four-combination table -> added under the seam diagram to make the orthogonality claim auditable.
- discard list -> expanded with `ChainRpcMethods.ts`, chain `types.ts`, possible `EvmRpcKernel` / `WorkerEvmBridge` second rpc kernel, `EvmHandle` / `EvmAdapter` / `ChainHandle` wrappers, harness-level `chainPort` field on worker entry/types, `chainBridge` field on `ThreadedHarness` + ctor arg on `ThreadedLifecycleActions`, chain exports from `threaded/index.ts`, and the affected `__tests__` (`ChainBridge.test.ts`, `PeerWorker.test.ts`, `ThreeWorkerSmoke.test.ts`, `EvtFifoContract.test.ts`, `LoopGuard.test.ts`).
