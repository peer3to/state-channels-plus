# master-plan v2 — critical review

reviewer voice: harsh, fragments, no benefit-of-the-doubt. the cost of approving a still-over-spec'd v2 after a wrong-shape v1 is too high.

scope: `master-plan.md` + `W0-cross-cutting-decisions.md`. cross-referenced against `test/harness/threaded/actions/meeting_notes/summary.txt` and the v1 `docs/parallel-plan/`.

---

## 1. verdict

**APPROVE-WITH-CHANGES.**

the shape is right. boss-mandated points (D-1..D-10) are stated cleanly. v1's wrong-shape concepts are explicitly named in the discard list, not silently kept. work items collapse from v1's nine to six, and several of those six are mostly "delete and slim". this is the leanness the meeting demanded.

what blocks a clean APPROVE: a handful of un-pinned design decisions still implicitly leave the door open to v1-era patterns (W1 "register named inline ops the worker knows by id" is one yellow flag), and the plan never commits to a default for `dedicatedPeerThread`. those are fixable with paragraph-sized edits, not another rewrite.

it is NOT NEEDS-REWORK. the meeting summary is internalized. the architecture diagram puts LocalTransport on the peer↔peer wire and MessagePort only on orchestrator↔worker. that's the single most important thing the v1 plan got wrong, and v2 gets it right.

---

## 2. boss-alignment audit

nine non-negotiables, one line of evidence each:

| #   | non-negotiable                                                | status        | evidence                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | peers talk over p2p network (LocalTransport), not MessagePort | **respected** | `master-plan.md` "LocalTransport across workers" + diagram L44-L48; W0 D-1.                                                                                                                                                                                         |
| 2   | MessagePort is only orchestrator ↔ worker                    | **respected** | `master-plan.md` "key invariant" L54; W0 D-2. star topology stated by construction.                                                                                                                                                                                 |
| 3   | one polymorphic harness, internal dispatch                    | **respected** | `master-plan.md` "polymorphic harness model" L62-L72; W0 D-3. one class, private factory.                                                                                                                                                                           |
| 4   | tests do not change                                           | **partial**   | W0 D-4 says so, but the plan never states the opt-in mechanism's _default_. if the default flips, tests effectively change. plan says "env var or session option" with no commitment.                                                                               |
| 5   | no double code                                                | **respected** | discard list at `master-plan.md` L102-L123 names every parallel-namespace class by name. one `PeerHandle`, one impl per action.                                                                                                                                     |
| 6   | minimal surface                                               | **partial**   | discard list is strong, but W1's "data-ify lambdas, or register named 'inline ops' the worker knows by id" leaves a surface-expansion path open. that v1 module (`InlineOpRegistry`) is in the discard list — yet the same idea is described as still on the table. |
| 7   | 2N+1 thread model, evm-per-peer orthogonal                    | **respected** | W0 D-7; `master-plan.md` L56-L58 "compose, don't re-design".                                                                                                                                                                                                        |
| 8   | push and pull on one channel                                  | **respected** | W0 D-8; W3 "one port or two" listed as open with strong hint toward one.                                                                                                                                                                                            |
| 9   | loop-delay guard is boss-owned                                | **respected** | W0 D-9; W6 "we consume; we do not design".                                                                                                                                                                                                                          |

net: 7 respected, 2 partial, 0 violated. partials are scoped and fixable.

---

## 3. over-engineering check

walking each W item against "does it earn its existence?".

### W1 — `PeerHandle` and one-harness polymorphism

- **earns existence:** yes. this _is_ the boss mandate. one class, internal dispatch.
- **collapse candidate:** no. this is the load-bearing item.
- **v1 momentum smell:** **major**. open question 2 ("data-ify lambdas, or register named 'inline ops' the worker knows by id") is the same shape as v1's discarded `InlineOpRegistry`. registering named ops in the worker by id is a parallel registry of behavior on the worker side -> double code by construction. the resolution must be "data-ify or refactor the action to not need a lambda", not "build an op registry".
- **minor:** the surface of `PeerHandle` is "derived from `git grep` against existing action files". fine as a method, but the plan should commit to a _cap_ (e.g. <15 methods) so review can hold the line.

### W2 — worker bootstrap (`PeerWorker`)

- **earns existence:** yes. workers need an entry script, BigInt patch, p2pSetup wiring.
- **collapse candidate:** could partially fold into W3 (the rpc kernel is what makes the worker reachable). leaving them separate is fine if W2 stays small.
- **v1 momentum smell:** none significant. the open question about pool reuse is honest.
- **minor:** "ship contract addresses / abis to the worker" via DeploymentRegistry is the right move, but the v1 implementation should be inspected and slimmed, not lifted whole.

### W3 — harness ↔ worker rpc kernel

- **earns existence:** yes. boss's own description of his evm executor pattern is exactly this.
- **collapse candidate:** no.
- **v1 momentum smell:** **minor**. plan says "slim to what we actually use; delete dual-port topology if a single port suffices; delete features that no caller needs." good intent. but "open question: which `PeerRpcErrors` survive" telegraphs that an error taxonomy already exists from v1 that may be over-spec'd. -> action: bias toward `Error` + a `code` string, not a hierarchy.
- **minor:** cancel semantics on test failure / disconnection is listed open. that's a real concern (afterEach must not hang) — should be answered before merge, not after.

### W4 — spies and barriers across the boundary

- **earns existence:** yes. boss explicitly named this pattern.
- **collapse candidate:** could merge with W3 (it's just one push channel topic). keeping it separate is justified only if there's barrier _logic_ (debounce, predicate composition) beyond pure transport. plan implies yes (debouncing, predicate evaluation on orchestrator). ok.
- **v1 momentum smell:** none significant. `SpyRegistry`/`SpyMirror` is named as a shape, not as code to copy.
- **minor:** "do we expose sinon's `getCalls()` payloads, or only counts?" — strongly default to counts. payloads-across-thread is where v1-era complexity creeps back.

### W5 — compose with boss's evm-in-thread PR

- **earns existence:** weak. "wire one Boolean through, document the seam." that is a sub-task, not a work item. half a day of work.
- **collapse candidate:** **yes**. fold into W2 (worker bootstrap is where the flag lands anyway). having a whole W slot for "pass a Boolean down" inflates the plan visually and invites scope creep.
- **v1 momentum smell:** plan correctly says "we wait and adapt". good.

### W6 — consume the loop-delay guard

- **earns existence:** yes, but barely. it is "receive a structured push, emit a test failure, drain on teardown."
- **collapse candidate:** **yes**, partially. the receive-push is W4 territory (push channel). the only W6-specific thing is the orchestrator-side aggregation + cleanup policy. could be one section of W4.
- **v1 momentum smell:** **minor**. open question "whether to capture an async stack at the moment of stall (`async_hooks`)" — plan does add the qualifier "only if a real flake demands it". keep that discipline.

**summary of blockers / majors / minors:**

- **blocker:** none.
- **majors:**
    - W1 OQ#2 "inline-ops registry" is v1 momentum under a new name. resolve to "no registry, data-ify lambdas" or to "narrow registry of N known transition fns, capped".
    - W4/W6 risk re-importing v1's stack-trace transport / payload-capture complexity. nail the "counts not payloads" default in W0.
- **minors:**
    - W5 should collapse into W2.
    - W6 push-plumbing should collapse into W4; only the aggregation/cleanup remains W6-specific.
    - `PeerHandle` should carry a method-count cap as a guardrail.
    - default for `dedicatedPeerThread` is unstated -> tests effectively change if it flips on.
    - W3 cancel/disconnect semantics is open and load-bearing for afterEach hygiene. close before flesh-out.

---

## 4. lessons-from-v1 audit

the discard list at `master-plan.md` L102-L123 is unusually honest. each discarded module is named and given a one-line rationale tied to a non-negotiable. that is the right shape.

verify v1 wrong-shape concepts are NOT implicitly snuck back in:

- **PortMesh / PortTransport** — clearly out. `master-plan.md` L83 "delete all of it." -> no parallel transport. ✓
- **ChainBridge / PortEip1193Provider** — explicitly discarded. ✓ minor watch: if boss's evm-in-thread PR ends up needing a host-side rpc the orchestrator forwards, the temptation will return. plan should add a D-row "no harness-side eth provider shim; if needed, request boss-owned addition."
- **IPeerHarness** — explicitly discarded. but the on-disk file `test/harness/IPeerHarness.ts` still exists. discard list must produce a deletion PR, not a doc-only note.
- **MathThreadedHarness** — discarded as a separate class. `MathPeerTestHarness` kept (just a typing specialization). on-disk file `test/harness/threaded/MathThreadedHarness.ts` exists and must go.
- **describeWithHarness / useMode / HARNESS_MODE** — discarded. ✓
- **parallel action-namespace classes** — discarded. on-disk: `test/harness/threaded/actions/Threaded{Lifecycle,Query,Network,Assert,Transition,Event,AssertSnapshot}Actions.ts` all exist and all need to die. discard list must translate to deletions in W1.
- **InlineOpRegistry** — listed as discarded _and_ listed as a possible W1 design (under a different framing). this is the one concept that has snuck back in. flag it.

did the plan honestly say "we're discarding X because of boss expectation Y"? yes — almost line for line. that is the most reassuring signal that v1's lessons were absorbed.

what is missing from the lessons section: the plan never names _why_ v1 happened. one line acknowledging "v1 was driven by 'what if we replace LocalTransport entirely' rather than 'what if peers stay on LocalTransport and we just put them in different processes'" would help future contributors not re-litigate the same wrong turn.

---

## 5. open questions

cross-cutting unknowns the W-item OQ lists do not cover:

1. **default for `dedicatedPeerThread`.** is it off-by-default and tests opt in, or on-by-default and tests opt out? if on, "tests do not change" is a fiction the first time a test breaks under threading. recommend off-by-default until parity is proven, then flip in a labeled commit.
2. **CI strategy.** with 2N+1 threads per test and parallel mocha workers, what is the cap? boss raised the spin-up overhead concern in the meeting (≈120 node processes for 12 parallel tests × 5 peers). plan does not name a CI budget.
3. **`PeerHandle` non-serializable returns.** plan says "anything that returns a non-serializable object ... is replaced by serialized data or by a worker-side handler that takes a request describing what to do." which existing action methods return non-serializable objects? a survey is implied; should be a W1 deliverable, not a hand-wave.
4. **`afterEach` worker drain on test failure / loop-delay-guard fire.** named in W3 and W6 separately, but the policy isn't unified. needs a D-row: "on test failure, orchestrator sends shutdown rpc with a deadline; on timeout, terminates the worker."
5. **lambda capture in `h.transition.sequenceFromHonestPeers`.** named as W1 OQ. this is the one place where "tests do not change" collides with "lambdas can't cross workers". the resolution will likely require a small test surface change (caller passes a named, registered transform). plan should acknowledge that "tests do not change" has a footnote here.
6. **how does the worker know which deployed contract address to use?** named in W2 OQ as DeploymentRegistry. but the on-disk hardhat deployment lives in the orchestrator's process — needs a serialization contract specced before W2 can be implemented.

the W-item OQs are sufficient for each item in isolation. the cross-cutting list above belongs in W0 as D-rows, not scattered across W docs.

---

## 6. recommendations

before any sub-W flesh-out begins, make these edits to `master-plan.md` and `W0-cross-cutting-decisions.md`:

1. **add D-11 in W0:** "no worker-side op registry. action lambdas are data-ified or, where impossible, the action surface changes — not the worker's behavior catalogue." closes the W1 OQ#2 v1-momentum loophole.
2. **add D-12 in W0:** "`dedicatedPeerThread` is off-by-default until per-suite parity is demonstrated; flip in a labeled commit." closes the boss expectation #4 partial.
3. **collapse W5 into W2 and W6's push-plumbing into W4.** restate the W item list as four items: W1 (PeerHandle + polymorphism), W2 (worker bootstrap + flag passthrough + DeploymentRegistry), W3 (rpc kernel), W4 (push channel: spies, barriers, loop-delay reports). W6 retains only "orchestrator aggregation + cleanup policy." this is the visual leanness boss asked for.
4. **add a "discard list -> deletion PR" line.** the discarded modules listed in `master-plan.md` L113-L123 still exist on disk. before W1 flesh-out, a single deletion PR removes `IPeerHarness.ts`, `threaded/ThreadedHarness.ts`, `threaded/MathThreadedHarness.ts`, `threaded/actions/*.ts`, `threaded/InlineOpRegistry.ts`, `threaded/MathThreadedTransitionActions.ts`, `threaded/__tests__/`. doc-only discards rot.
5. **add a one-line "why v1 happened" lesson.** "v1 framed the problem as 'replace LocalTransport with a worker-aware transport'; v2 frames it as 'keep LocalTransport, move the peer that owns it into a worker'." prevents the next contributor from re-litigating the same turn.

these are all paragraph or D-row edits, no architectural reshuffles. then green-light sub-W explorer agents.

---

## final report (≤200 words)

**verdict: APPROVE-WITH-CHANGES.**

the shape is right. boss's nine non-negotiables -> 7 respected, 2 partial, 0 violated. v1's wrong-shape concepts (PortMesh, PortTransport, IPeerHarness, ThreadedHarness, parallel namespace classes, describeWithHarness) are explicitly discarded with rationale tied to expectations. architecture diagram correctly puts LocalTransport on the peer↔peer wire and MessagePort only on orchestrator↔worker.

**top issues (none rise to blocker):**

1. W1 open question on "register named inline ops the worker knows by id" is v1's `InlineOpRegistry` under a new name. close it with a D-row: "no worker-side op registry; data-ify or change the action."
2. default for `dedicatedPeerThread` is unstated -> "tests do not change" only holds if it stays off-by-default.
3. discarded modules still exist on disk. discard list needs a deletion PR before W1 flesh-out, otherwise doc-only discards rot.

**top nits:**

1. W5 (one boolean passthrough) should fold into W2; W6's push-plumbing should fold into W4.
2. cross-cutting unknowns (CI budget, afterEach drain policy, lambda-capture footnote) belong as D-rows in W0, not scattered.
3. add one line on "why v1 happened" so the next contributor doesn't repeat it.

fix items 1-3 above (paragraph-sized edits), then green-light explorer agents.
