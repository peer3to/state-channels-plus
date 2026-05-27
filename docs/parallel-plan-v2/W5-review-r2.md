# W5 review round 2 — evm-in-thread seam

reviewer pass against revised `docs/parallel-plan-v2/W5-evm-in-thread-seam.md` + revision log, cross-checked against r1 findings and a grep sweep of `test/harness/threaded/`.

---

## 1. round-1 findings disposition

| r1 finding                                                                                                                                                    | sev   | status   | evidence                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W5 prescribes boss's PR via pre-conditions (`(b) is the cleaner outcome`, `one knob, two callsites`)                                                          | MAJOR | resolved | §"confirmation checklist" rewritten — every item is now a `confirm with boss` question. no "preferred outcome" language remains. revision log line 117 calls this out explicitly. spot-check items 1, 4 -> options enumerated, no preference expressed.                                                                                                                                      |
| §questions ratifies `InlineContractExecutor` / `WorkerContractExecutor` as if chosen                                                                          | MAJOR | resolved | both occurrences replaced with `[placeholder for boss's chosen names]` (lines 14, 39, 78). revision log line 118 confirms. question 1 now asks "what are the class names ... once boss's PR lands?" without proposing them.                                                                                                                                                                  |
| chain-instance manager item speculates about hardhat sharing                                                                                                  | MAJOR | resolved | line 58: "chain instance lifecycle is boss's call inside his executor — we record what he ships and add nothing. we do not speculate about hardhat sharing strategy here." prior parenthetical gone. revision log line 119.                                                                                                                                                                  |
| discard list incomplete (`EvmHandle`/`EvmAdapter`/`ChainHandle`, `EvmRpcKernel`/`WorkerEvmBridge`, harness `chainPort` field, `__tests__` for executor shims) | MINOR | resolved | discard list now lines 91–102: adds `ChainRpcMethods.ts`, `types.ts`, the `*Handle`/`*Adapter` wrappers, the second-rpc-kernel candidates, the `chainPort` field on `worker/entry.ts` + `worker/types.ts`, the `chainBridge` field on `ThreadedHarness` + ctor arg on `ThreadedLifecycleActions`, chain exports from `threaded/index.ts`, and five `__tests__` files. revision log line 122. |
| question 4 conflated chain-handle assertion with open question                                                                                                | MINOR | resolved | line 81 now reads "assumption: the polymorphic executor he described handles its own chain access; the harness passes no chain handle through. confirm." phrased as assumption-to-confirm, matches r1 fix.                                                                                                                                                                                   |
| summary overcommits with `harnessConfig.dedicatedEvmThread` / `EvmStateMachine.p2pSetup`                                                                      | MINOR | resolved | line 112: "one boolean forwarded from our harness config through our existing `p2pSetup` callsite; whatever name boss picks on his side is what we read." our-side wiring named, boss-side left tbd.                                                                                                                                                                                         |
| §"what boss already built" risks drift into PR-design                                                                                                         | NIT   | resolved | section trimmed to the four facts the seam depends on (executor split, factory chooses, boolean opt-in, request/response by id). each fact carries a `[placeholder]` or `name tbd` marker.                                                                                                                                                                                                   |
| four-combination matrix in prose only                                                                                                                         | NIT   | resolved | table now lines 43–48; orthogonality claim auditable.                                                                                                                                                                                                                                                                                                                                        |
| `(boss's boolean, name tbd)` vs `dedicatedEvmThread` inconsistency                                                                                            | NIT   | resolved | `<boss's evm boolean, name tbd>` used in diagram (line 30) and summary (line 112). `dedicatedEvmThread` retained only inside a verbatim quote of D-18's open status (line 131 in W0, not in W5 body). consistent.                                                                                                                                                                            |

all eight r1 findings resolved with evidence in the doc and revision log.

---

## 2. discard-list grep sweep (does it match v1 reality?)

cross-referenced discard list against `grep -rln "chain\|Chain" test/harness/threaded/`. concrete v1 surface confirmed:

- `test/harness/threaded/chain/` — `ChainBridge.ts`, `PortEip1193Provider.ts`, `PortJsonRpcProvider.ts`, `ChainRpcMethods.ts`, `types.ts` -> all five enumerated in discard list. clean.
- `worker/entry.ts` lines 35–36, 103, 332–358 (`chainPort`, `chainShim`, `chainRpcClient`, `drainChainInFlight`, `PortEip1193Provider` import) -> covered by "harness-level `chainPort` field on the worker entry" bullet.
- `worker/types.ts` line 89 (`chain: MessagePort` in channels payload) -> covered by same bullet.
- `ThreadedHarness.ts` lines 33, 71, 149, 169, 339 (`chainBridge` field + ctor wiring + dispose) -> covered by "`chainBridge` field on `ThreadedHarness`" bullet.
- `actions/ThreadedLifecycleActions.ts` lines 35, 112, 176 (ctor arg + per-peer `chain` port assignment) -> covered by "ctor argument on `ThreadedLifecycleActions`" bullet.
- `index.ts` lines 70–87 (chain re-exports) -> covered by "chain-related exports from `test/harness/threaded/index.ts`" bullet.
- `__tests__`: `chain/__tests__/ChainBridge.test.ts`, `worker/__tests__/PeerWorker.test.ts`, `__tests__/ThreeWorkerSmoke.test.ts`, `events/__tests__/EvtFifoContract.test.ts`, `guard/__tests__/LoopGuard.test.ts` -> all five enumerated.

**discard list is complete for the v1 chain stack as it stands in this branch.** the grep sweep produces no surviving chain references that aren't covered by the list or by the catch-all bullet ("anything else built to give a worker peer a chain handle outside boss's executor falls under this list").

one observation, not a finding: `__tests__/FullStackSmoke.test.ts` and `__tests__/HarnessSmoke.test.ts` carry chain-bridge comments but no direct `ChainBridge` plumbing, so they correctly stay off the list — they'll survive once the imports they describe disappear.

---

## 3. boss-prescription audit (the central r1 concern)

re-read with hostile eye for any sentence that still designs boss's PR:

- §"what boss already built": every concrete name carries `[placeholder for boss's chosen names]` (lines 14, 39, 78) or is a verbatim quote from the may 26 transcript. no invented identifiers. clean.
- §"the seam this plan exposes": diagram uses `<boss's evm boolean, name tbd>`. text says "whatever entry point boss exposes" and "by calling boss's factory through whatever entry point boss ships". clean.
- §"what this plan does NOT do": each bullet is a refusal on our side, not a prescription on boss's side. the chain-instance bullet now explicitly says "chain instance lifecycle is boss's call" — clean.
- §"confirmation checklist": all five items are "confirm with boss" questions phrased as observations. item 1 enumerates two imagined options ("a plain function imported from `src/evm`" vs "`EvmStateMachine.p2pSetup` accepts the boolean and calls the factory internally") and says "record which" — does NOT prefer either. clean.
- §"questions to confirm with boss": every question is a question. assumption-form (item on chain handle, line 81) phrased "assumption ... confirm". clean.

**verdict: no surviving prescriptive language. W5 has fully retreated to seam-only posture.**

---

## 4. new findings (round-2 only)

### BLOCKER

none.

### MAJOR

none.

### MINOR

- **r1's NIT about title was not actioned, but it's now moot.** the title is `# W5 — compose with boss's evm-in-thread PR (seam, not impl)` — already correctly framed. r1 flagged the body diving into reconstructed internals; the body has since been trimmed and every concrete claim now carries a placeholder marker. acceptable as-is.

### NIT

- §"what to delete from v1 when boss's PR lands" preamble says "non-exhaustive — anything else built to give a worker peer a chain handle outside boss's executor falls under this list." good. consider adding a single line: "discard list checked against grep `chain\|Chain` in `test/harness/threaded/` at <branch sha>; re-run before boss's PR merges to catch additions." purely for auditability. optional.

---

## 5. verdict

**READY FOR PDR.**

W5 r1's three MAJORs and three MINORs are all resolved with traceable evidence in the document body and a fresh revision log. the discard list survives a grep sweep against the v1 stack on this branch. no new blockers or majors surfaced.

posture is correct: W5 sits and waits for boss's PR, then the team executes the five-item confirmation checklist, deletes the v1 chain-bridge stack per the enumerated list, and ships. nothing else for the doc to do until boss lands.
