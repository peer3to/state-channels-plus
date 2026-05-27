# W2 review — worker bootstrap

reviewer pass against `docs/parallel-plan-v2/W2-worker-bootstrap.md`. cross-checked against W0 (D-1..D-10), W1 (seams), the summary.txt, and the current codebase.

---

## 1. boss-alignment per non-negotiable

| #   | rule                                  | status                        | evidence                                                                                                                                                                                              |
| --- | ------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| 1   | peer↔peer is LocalTransport          | respected                     | §2 step 6 (`p2pSetup` with no `transportFactory`); §3 wires LocalDiscoveryServer ws; §10 explicit                                                                                                     |
| 2   | MessagePort orchestrator↔worker only | respected                     | §1 spawns exactly two channels (control + rpc); §10                                                                                                                                                   |
| 3   | one polymorphic harness               | respected (out of W2's scope) | §1 PeerWorker is a backend used by W1's `WorkerPeer`; no second harness class introduced here                                                                                                         |
| 4   | tests do not change                   | respected                     | nothing in W2 surfaces to mocha; spawn args are internal                                                                                                                                              |
| 5   | no double code                        | partial                       | §3 fallback proposes a ~60-line copy of `connectToPeers` body (`connectViaDiscovery.ts`). D-11 (preferred path) avoids it. but the doc still ships the fallback in §11 file layout, hedging both ways |
| 6   | minimal surface                       | partial                       | `PeerWorkerSpawnArgs` has 10 fields, all justified — fine. but §1 adds `terminateSync()`, `drainDetached()`, `on("log"                                                                                | "detached-rejection" | "crash" | ...)`— see findings.`BootstrapPhase` lists six named stages, some over-granular (see findings) |
| 7   | 2N+1, EVM-per-peer orthogonal         | respected                     | §6.2 explicitly defers chain seam to boss's PR; §1 ships no evm port                                                                                                                                  |
| 8   | push + pull on one channel            | respected                     | §1 single rpc port; §2 step 5 emits loop-stall over rpc push                                                                                                                                          |
| 9   | loop-delay guard boss-shipped         | respected                     | §2 step 5 samples, no policy; §10 explicit                                                                                                                                                            |

---

## 2. findings

### BLOCKER

**B1 — provider URL bootstrap is fragile and contradicts D-10.**

- claim. §6.1 requires running threaded tests against a real `npx hardhat node` via `--network localhost`, with `args.providerUrl = "http://127.0.0.1:8545"`. D-12 (proposed) codifies it.
- evidence. §6.1 (a); §1 `providerUrl: string` field marked required.
- problem. (i) the rest of the e2e suite runs against hardhat's in-process EVM; flipping to `localhost` is a behavior change, not a "one line in package.json". hardhat's `node` lacks the deploy fixtures the suite relies on (`deployments`, snapshots, automine settings) unless explicitly re-deployed against it. (ii) inline-mode tests would then need to keep working against the in-process EVM while worker-mode tests target a separate node — two truths about chain state, two test matrices. (iii) D-10 says "no production runtime changes required by this plan"; spinning up a separate hardhat node is a runtime change _for tests_ that masks the real seam decision.
- fix. drop §6.1(a). either (i) explicitly state that worker bootstrap **blocks on W5/boss's evm-in-thread PR** for chain access — workers do not start until that seam exists — or (ii) ship §6.1(b) (the in-process HTTP bridge over `hre.network.provider`) as the v2 interim, since it preserves the single chain-state source of truth. pick one, do not list (a) as the default.

**B2 — D-11 (`registryPort` opt-in param on `LocalDiscoveryServer.connectToPeers`) misframes the prod impact.**

- claim. §3 / D-11: "four-line change in `src/utils/LocalDiscoveryServer.ts`; production callers unaffected."
- evidence. `src/P2PManager.ts:134-141` — the only non-test caller of `LocalDiscoveryServer.connectToPeers` is gated behind `if (config.DEBUG_LOCAL_TRANSPORT) { return; await ... }`. the early `return` makes the subsequent `connectToPeers` call **unreachable in prod** (prod uses holepunch). so "production callers unaffected" is technically true but only because prod doesn't call it at all today.
- problem. the framing oversells the change. it is a test-only path being parameterized to accept a port — that's fine — but the doc presents it as a careful production-touching change when it isn't. also, the function reads `discoveryPort` at 14 sites (§3 line refs: 579-924). a "four-line" parameter addition needs to thread the override through `connectRegistry`'s closure too, or only the first check honors it.
- fix. rewrite D-11: "test-only path; takes an explicit `registryPort` parameter (required, not optional). prod caller in P2PManager is dead code today, can be deleted or left." also acknowledge that the override must propagate to every `this.discoveryPort` read on the connect path, not just the first guard.

### MAJOR

**M1 — control vs rpc port split is gratuitous given D-8.**

- claim. §1: `spawn()` constructs **two** MessageChannels (`control` for lifecycle, `rpc` for W3 frames).
- evidence. D-8 says push + pull on the same channel, "same channel, one abstraction." §1 `getControlPort()` + `getRpcPort()` exposes two.
- problem. lifecycle frames (`ready`, `dispose`, `disposed`, `crash`, `log`, `detached-rejection`) are low-volume and would compose fine on the rpc port with a `kind` discriminator — the W3 frame envelope already needs one. v1's three-port split (control/req/evt/chain) was the over-engineering W2 is supposed to repudiate; collapsing four → two is progress, but the doc doesn't justify why two beats one. boss's words: "it's just like a socket. you can have both push and you can do a request" — singular.
- fix. start with one port. add a second only if a measured concern surfaces (e.g. ready handshake racing W3 frame setup — but that's solvable with a "rpc-ready" gate on the same port). drop `getControlPort()` / `getRpcPort()`; expose one `getPort()`.

**M2 — `BootstrapPhase` over-granularity.**

- claim. §2 lists six phases: `loggerInit`, `walletConstruct`, `provider`, `channelManagerConnect`, `p2pSetup`, `rpcRegister`.
- evidence. §2 step 6.
- problem. four of these (`loggerInit`, `walletConstruct`, `channelManagerConnect`, `rpcRegister`) are trivially-failing or trivially-succeeding steps. `walletConstruct` fails iff the pk is malformed (caller bug). `loggerInit` fails essentially never. `channelManagerConnect` is just `__factory.connect(addr, signer)` — a constructor with no I/O. attribution at this granularity is only useful when a stage actually has interesting failure modes. `provider` and `p2pSetup` are the only two with real failure modes.
- fix. collapse to three phases: `boot` (everything up to provider), `provider`, `p2pSetup`. add more only when a real flake demands attribution.

**M3 — deployment registry concept smuggles back complexity D-6 rejects.**

- claim. §4 ships a string-keyed `deploymentRegistry` with bundle files under `worker/bundles/deployments/<name>.ts` that self-register on side-effect import.
- evidence. §4; §11 file layout shows `bundles/deployments/index.ts`.
- problem. (i) the existing registry in `test/harness/core/deploymentRegistry.ts` (per §4) already exists — fine. but §11 adds a _new_ `worker/bundles/deployments/` tree with its own `index.ts` of side-effect imports. that's two registries: the in-process one tests already use, and a worker-side parallel tree. (ii) side-effect-import-as-registration is the pattern that makes test bundles hard to reason about — adding a deployment is now "edit two places, hope you imported the index". (iii) summary.txt notes boss's intent: "even if we wanted to swap it out for a full node implementation, ... it would be straightforward now" — i.e. the deployment seam should be _simpler_, not duplicated.
- fix. one registry, used by both inline and worker callers. worker entry imports the same `test/harness/core/deploymentRegistry.ts` (or wherever the canonical map lives). delete `worker/bundles/deployments/`. resolve by `deploymentName` against the single map. if a deployment can't be statically imported on the worker side (closure in the config), that's a separate function-value-shipping problem — solve it once in W1 (named ops), don't replicate the W1 pattern with a parallel registry here.

**M4 — `customPrecompiles` / `rpcServiceFactories` omitted without a migration plan.**

- claim. §7 / D-13: omit from `PeerWorkerSpawnArgs`; hardcode `customPrecompiles: []` and `rpcServiceFactories: {}` in the worker's `p2pSetup` call.
- evidence. §7.
- problem. accurate grep — `test/e2e/` doesn't use them. but `test/evm/EvmFactory.test.ts:57` does, and the SDK exposes these fields publicly. when `dedicatedPeerThread: true` is set on a test that does pass `customPrecompiles`, the worker silently ignores them and behaves differently from inline. that's a silent divergence between the two backends — D-3 says "from the usage, it's indifferent." silent ignoring is not indifferent.
- fix. either (a) detect non-empty `customPrecompiles`/`rpcServiceFactories` and throw `UnsupportedHarnessOptionInWorkerMode` at spawn time (loud failure, not silent divergence), or (b) require the W1 named-op / factory-id registry from day one. don't pick (a) without writing it down in D-13.

### MINOR

**m1 — `terminateSync()` on the orchestrator handle is a process-exit foot-gun.**

- claim. §1 exposes `terminateSync(): void` "for process.exit hook only".
- problem. `worker.terminate()` returns a promise; calling it sync from a `process.exit` hook doesn't wait for the worker to actually die. it doesn't make exit "synchronous" — it just fires-and-forgets. either drop it or rename to `requestTerminate()` so callers don't think it blocks.

**m2 — `bootMetadata.bootDurationMs` / `pid` / `tid` are noise unless someone reads them.**

- claim. §1 `bootMetadata: ReadyPayload` exposes `peerAddress, bootDurationMs, pid, tid`.
- problem. unused observability. D-6 says "any new public api is rejected unless it is required." `peerAddress` is justifiable (orchestrator needs it before rpc resolves). drop the rest until W6 or someone proves they're load-bearing.

**m3 — boot-timeout defaults assertion needs evidence.**

- claim. §1 "boot-timeout defaults: 60s first spawn, 15s subsequent (existing constants)."
- problem. unclear where these come from; ts-node first-compile is the obvious culprit but no measurement is cited. minor because it's just a default.
- fix. cite the constant location or note it's TBD.

**m4 — §11 deletion list is partial.**

- claim. §11 "deleted (vs current threaded/): chain/, transport/, ..."
- problem. doesn't list `ThreadedHarness.ts`, `MathThreadedHarness.ts`, `RemotePeerHandle.ts` as _here_ — pushes them to "W4's call" / "W1's collapse." that's fine for separation of concerns but the W2 reader has no single picture of what threaded/ looks like post-merge. add a one-line "see W1 for X, W4 for Y" forward reference.

### NIT

**n1.** §1 `getRpcPort(): MessagePort` returns a node MessagePort — but W3 frames lib.dom-shaped ports. doc handwaves "cast at the boundary"; fine but call it out at the type level (one helper).

**n2.** §3 ascii diagram says "binds local PeerServer" — but `connectToPeers` does that itself; the worker just calls into the static method. diagram suggests the worker is doing extra work it isn't.

**n3.** ts-node decision (§8) is honest about tradeoffs (good), but doesn't mention that workers inheriting hardhat's ts-node register is non-obvious — workers are fresh isolates. confirm the shim actually re-registers ts-node in-isolate. (it does today, per existing entry.js — just call it out.)

---

## 3. verdict

**APPROVE-WITH-CHANGES.**

the doc gets the big shape right: v1's `PortTransport`/`PortMesh`/`ChainBridge`/`PortEip1193Provider` are explicitly deleted (§10), LocalDiscoveryServer reuse is verified against actual code (§3), and the surface is honest about what it defers (§6.2, §7, §8, §9). but two issues need rework before merge: (B1) the provider-URL story can't ship as drafted, and (B2) the D-11 framing oversells the prod-touch. M1-M4 are about trimming overspec that crept in despite D-6.

---

## final report

verdict. APPROVE-WITH-CHANGES.

top 3 issues.

1. (B1) §6.1 / D-12 — running threaded tests against `--network localhost` is not a one-liner; it forks the chain-state source of truth between inline and worker modes. pick the HTTP-bridge interim (§6.1.b) or block on W5/boss's PR; do not list the separate-node path as default.
2. (B2) D-11 — `registryPort` parameter is fine, but framed as "production callers unaffected" when the prod caller (P2PManager.tryOpenConnectionToChannel) is dead code anyway. also a four-line edit will miss the 14 `discoveryPort` reads downstream of the first guard — must thread through `connectRegistry`'s closure.
3. (M1, M3) two MessagePort channels (control + rpc) violate D-8's "one abstraction" spirit; new `worker/bundles/deployments/` tree duplicates the existing `deploymentRegistry.ts`. collapse to one port, one registry — both are exactly the over-engineering D-6 forbids.
