# W5 — chain-access design for threaded peer workers

source of truth: `docs/parallel-plan-v2/W5-evm-in-thread-seam.md` (`what remains blocked`).
related: `docs/parallel-plan-v2/master-plan.md`, `docs/parallel-plan-v2/W0-cross-cutting-decisions.md` (D-10, D-15, D-18).
status: research + recommendation. no code changes this round.

---

## 1. executive summary

recommendation -> **option A1: HTTP-served `hardhat node`, one node per test-process, port 0 (kernel-picks-free), URL piped into spawn args.** `yarn test:e2e:parallel` already gives us one mocha process per test case via `scripts/test-e2e-parallel.js` -> "one chain per test" falls out for free. inline mode stays on `hre.ethers.provider` (no behaviour change). only worker mode dials HTTP. cost: ~1 file (a port-0 hardhat-node bootstrap + dispose), ~10 lines wired into the harness `setup`. no v1 chain-bridge resurrection.

top tradeoff: a few ms of HTTP latency per chain call inside threaded e2e tests + one extra in-process listener per test process. honest, production-shaped, isolated; doesn't graze any boss non-negotiable.

---

## 2. how `yarn test:e2e:parallel` works today

**not mocha `--parallel`.** the script at `scripts/test-e2e-parallel.js` is a custom orchestrator:

- step 1 - it walks `test/e2e/**/*.test.ts` with ts-morph, extracts every `describe("E2E:...")` + `it(...)` pair (line 134 `extractE2ETests`).
- step 2 - for each `(suite, test)` pair it builds a task whose command is `yarn hardhat test --no-compile <file> --grep "^<suite>.*<test>$"`. so each task spawns its own `yarn hardhat test` child process targeting exactly one `it`.
- step 3 - tasks run in a pool of N workers (default 8, `--workers` flag) via `spawn(...)` in `runTask`. each child gets a fresh node process, fresh hardhat runtime, fresh `hre`. start is staggered by `E2E_WORKER_START_STAGGER_MS` (default 1000ms) so spawn cost doesn't dogpile.
- step 4 - failures are retried once in a parallel rerun phase. logs land under `./logs/<sanitized>.ansi`, renamed `error_*.ansi` on failure.

**implications for chain access:**

- "per test case" infrastructure is already "per process". every `it` runs in its own node process with its own `hre` and its own in-isolate hardhat network. no cross-test bleed today.
- there is no shared `hre` between tests in `test:e2e:parallel`. we don't need to invent process isolation - we have it.
- the `hardhat.config.ts` `mocha.timeout` is 90s; default test pool is 8; parallel runs hit ~30+ child processes during a full suite, but only ≤8 are alive at any moment.
- when boss's PR 339's `dedicatedPeerThread` is on, peers in that process want chain handles - and the hardhat provider object is captive in the main thread isolate. that's the gap.

---

## 3. the three viable options

### option A1 — HTTP `hardhat node`, one per test process, port-0

shape:

- inside each `test:e2e:parallel` child (one per `it`), the harness `setup` boots an HTTP hardhat node bound to port 0 (kernel picks free port). pattern mirrors `LocalDiscoveryServer.createServerWithRetry` (already does port-0 + retry).
- get URL `ws://127.0.0.1:<resolved>/` (or http), pipe into `PeerWorker.spawn({ chainProviderUrl })`. worker entry already wired to consume it (`worker/entry.ts:198,237`).
- inline mode is unchanged - still uses `hre.ethers.provider`.
- the deploy step (`deployContracts` in `PeerTestHarness`) keeps using `hre.ethers.provider` because the same in-isolate hardhat network backs both the in-process provider AND the served port (one `hre` per process, one shared chain state).

key trick: **hardhat exposes `TASK_NODE_CREATE_SERVER` as a public subtask** (`node_modules/hardhat/builtin-tasks/node.js:97`). we invoke it with `hre.run(TASK_NODE_CREATE_SERVER, { hostname: "127.0.0.1", port: 0, provider: hre.network.provider })` -> get a `JsonRpcServer` -> `await server.listen()` returns `{ port, address }`. we DO NOT use `TASK_NODE` (the full task that also starts compilation/watching/forking). we just want the HTTP wrapper around the existing in-isolate provider, NO new chain process, NO subprocess.

so this is **in-process HTTP**: same node process, same `hre.network.provider`, just served over a tcp socket so workers can dial it. chain state stays unified.

port allocation:

- per-test child process gets one port. port 0 -> kernel picks free -> recorded -> piped to spawn. no collisions with sibling test processes by construction.
- if for some reason a child is killed mid-test, the OS releases the port; the next test process picks fresh.

cleanup:

- in harness `cleanup` -> `await server.close()`. close is graceful; the in-process provider survives (it's `hre.network.provider`, not the server). mocha process exit also kills the server. if a test leaks, it dies with the process; no inter-test leak possible because there's no cross-test process.

single-thread compat:

- `dedicatedPeerThread=false` path doesn't touch the HTTP node. we still boot the node unconditionally in setup (cheap, ~10ms) so the wiring is uniform, OR boot it only when `dedicatedPeerThread === true`. recommend the latter -> no surprise cost on the bulk inline suite.

performance:

- in-process HTTP add ~0.5-2ms per call against loopback. e2e tests already wait seconds for agreement/evidence/dispute windows. negligible.

pros:

- production-shaped (peer dials a real RPC URL).
- one extra file: a `startHttpHardhatNode({ hre }) -> { url, close }` helper.
- port allocation is "port 0, ask kernel" - same idiom we already use for the discovery server.
- composes trivially with `test:e2e:parallel` (one node per child process).
- isolates per test case by construction (no `hardhat_reset` choreography).
- inline mode unchanged -> zero risk to today's green tests.

cons:

- one new file + ~10 lines in `PeerTestHarness.setup`.
- HTTP latency on chain calls (small).
- if a test spawns a worker that never disposes, the worker's `JsonRpcProvider` may hold a keep-alive socket -> hang on graceful shutdown. mitigate: short keepalive on the provider, force-close on `cleanup`.
- the `Clock` singleton inside the worker re-syncs against the HTTP provider. extra round-trip vs the in-process Clock. one-time per worker boot. acceptable.

risk to `test:e2e:parallel`: **none** (it's the design point).

### option A2 — single hardhat HTTP node for the whole suite

shape:

- one daemon-style `hardhat node` shared by every test process. tests reset state between via `hardhat_reset` (or revert/snapshot).
- requires a separate node process OR a long-lived port on the orchestrator.

pros:

- faster aggregate start (no per-process node boot, though that boot is already in-process and ~10ms).

cons:

- breaks isolation. `test:e2e:parallel` runs ≤8 tests concurrently against the SAME chain -> address collisions, nonce collisions, block-number contention, calldata-posting races between unrelated tests. catastrophic for a test suite where on-chain events drive correctness assertions.
- the `hardhat_reset` between tests requires single-threaded gating across processes -> have to invent a mutex (file lock? port lock?). that's a lot of plumbing for a small startup win.
- doesn't match the user's stated preference ("each test case has its OWN central chain").
- diverges from production shape too (real chain doesn't get reset between channel openings).

risk to `test:e2e:parallel`: **high**. would require restructuring the orchestrator script to serialize tests around chain resets. defeats the parallel speedup.

reject.

### option B — `PortJsonRpcProvider` over MessagePort (v1 chain-bridge resurrected)

shape:

- worker constructs a `JsonRpcProvider`-like object whose `send(method, params)` round-trips through the harness↔worker MessagePort. orchestrator services the rpc by calling `hre.ethers.provider.send(...)`.
- the wire is the existing rpc kernel (W3). no new ports, no http.

cons:

- the v1 stack we already deleted (`ChainBridge`, `PortJsonRpcProvider`, `ChainRpcMethods`) was ~800 LOC of routing + adapters. resurrecting any meaningful portion violates the W5 doc's `what to delete` list (lines 99-112) and explicitly contradicts boss's "MessagePort only for orchestration" (master-plan boss-expectation 2).
- chain calls aren't orchestration - they're an entire RPC surface. mixing them onto the same MessagePort would (a) compete with lifecycle/sub-handle traffic for kernel correlation IDs, (b) make backpressure / cancellation harder, (c) couple chain liveness to MessagePort liveness.
- doesn't compose well with subscriptions (`stateChannelManagerContract.on(filter, listener)` in `StateChannelEventListener.ts:112`). either we proxy subscription frames (more code) or workers can't subscribe (broken).
- and it's the exact thing the prior agent already wrote up as "v1 was wrong-shape".

pros:

- no port allocation, no HTTP, no separate listener.
- works against `test:e2e:parallel` trivially (just MessagePort - no shared resources).

risk to `test:e2e:parallel`: **none** mechanically; **high** to the design budget (boss non-negotiable graze + ~800 LOC undelete).

reject unless A1 hits a blocker we don't yet see.

---

## 4. recommendation

**option A1.**

why:

- `test:e2e:parallel`'s "one process per test" gives us per-test isolation for free. we don't have to invent it.
- port 0 + `TASK_NODE_CREATE_SERVER` is a ~30-line helper that reuses the in-isolate `hre.network.provider` -> no new chain process, no chain-state divergence, no cleanup choreography.
- single-thread path stays on `hre.ethers.provider` -> zero risk to today's green tests.
- composes with boss's PR 339 unchanged: the worker dials the URL, constructs `JsonRpcProvider + Wallet.connect(provider)`, calls `p2pSetup` against it (already wired in `worker/entry.ts:225-308`).
- production-shaped: peer talks to a real RPC URL, exactly like mainnet.

honest cost:

- one new harness file (~30 LOC) + ~10 LOC in `PeerTestHarness.setup` + ~10 LOC in `PeerTestHarness.cleanup`.
- HTTP latency on chain calls inside worker mode. small, eaten by the test's existing agreement/evidence waits.
- the `Clock` singleton inside each worker re-syncs against the HTTP provider on boot. one extra round-trip per worker spawn.

---

## 5. concrete plan (when this lands)

step 1 - new file `test/harness/threaded/chain/HttpHardhatNode.ts` (~30 LOC):

- exports `startHttpHardhatNode(hre): Promise<{ url, close }>` using `hre.run(TASK_NODE_CREATE_SERVER, { hostname: "127.0.0.1", port: 0, provider: hre.network.provider })` then `await server.listen()` and resolving to `http://127.0.0.1:<port>`.
- `close` calls `server.close()` plus a 2s force-close timeout.

step 2 - `PeerTestHarness.setup` (after `deployContracts`):

- if `this.options.dedicatedPeerThread === true` -> start the node, stash `this.chainProviderUrl`. otherwise skip.

step 3 - `PeerTestHarness.createPeerHandle` worker branch:

- remove the throw; construct `PeerWorker.spawn({ ..., chainProviderUrl: this.chainProviderUrl })`. spawn args field already exists.

step 4 - `PeerTestHarness.cleanup`:

- after the existing peer dispose / discovery cleanup, `await this.httpHardhatNode?.close()`.

step 5 - smoke test plan:

- start with `test/harness/threaded/__tests__/ThreeWorkerSmoke.test.ts` upgraded to actually run `p2pSetup` (today it stops at `boot`).
- next, pick the simplest e2e: `test/e2e/01_*.test.ts` whatever the smallest happy-path channel-open test is. run it with `HARNESS_DEDICATED_PEER_THREAD=true yarn test:e2e --grep "<that test name>"`.
- then run `HARNESS_DEDICATED_PEER_THREAD=true yarn test:e2e:parallel --workers 4` against the full suite. expect parity (or close, modulo W4/W5/W6 follow-ups).

step 6 - verify `test:e2e:parallel` unchanged at default (`dedicatedPeerThread=false`):

- `yarn test:e2e:parallel` with no env -> all tests run inline; the http node is never started; behaviour identical to today.

---

## 6. open questions

- **boss non-negotiable check:** master-plan boss-expectation 2 says "MessagePort is only orchestrator ↔ worker." option A1 routes chain access via HTTP, NOT MessagePort -> compliant. confirm we're not over-reading the rule (i.e. boss didn't mean "everything between orch and worker, including chain handles").
- **subscriptions over HTTP:** `StateChannelEventListener.ts:112` does `stateChannelManagerContract.on(filter, listener)`. ethers + hardhat's `JsonRpcServer` supports event polling via `eth_getFilterChanges`; ws subscriptions are not supported by the http-only server (hardhat's `node` task does support ws too - `TASK_NODE_CREATE_SERVER` returns both http and ws on the same port). need to verify under smoke that worker-side subscriptions actually fire. if not -> add fallback poll cadence.
- **W6 loop guard interaction:** ws subscription deadlines and event-loop stalls in the worker could cross the W6 stall threshold (1000ms default). confirm 1s is enough headroom for chain-call latency + worker work.
- **fork choice when `--network localhost`:** D-18 had a paragraph rejecting `--network localhost`. that was about the FULL `hardhat node` task with hardhat-deploy fixtures. A1 instead serves `hre.network.provider` (the same in-isolate provider tests already deploy against) over http. confirm with boss that this re-reading is what he meant.
- **inline mode going through HTTP too:** option A1 keeps inline on `hre.ethers.provider`. boss preference? "more honest to production" arg says go HTTP for everyone; "minimum delta" arg says don't. recommend keep inline as-is until/unless we observe behaviour divergence.

---

## summary

`test:e2e:parallel` already isolates per-test by process. exploit it: spin a port-0 in-process `JsonRpcServer` wrapping `hre.network.provider` when `dedicatedPeerThread=true`, dial it from the worker. one file, ten lines of wiring, no v1 resurrection, no boss non-negotiable grazed. inline mode untouched. ship.
