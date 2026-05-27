# W5 review — evm-in-thread seam

reviewer pass against `docs/parallel-plan-v2/W5-evm-in-thread-seam.md` and the may 26 boss meeting.

---

## 1. boss-alignment per non-negotiable

| #    | non-negotiable                             | status    | evidence                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | peer↔peer over LocalTransport             | respected | not in scope; not mentioned.                                                                                                                                                                                                                            |
| D-2  | MessagePort only orchestrator↔worker      | respected | §"what this plan does NOT do" explicitly notes harness MessagePort carries orchestration only; evm executor uses boss's own wire.                                                                                                                       |
| D-3  | one polymorphic harness, internal dispatch | respected | mirrors boss's executor polymorphism verbatim — §"the seam this plan exposes" shows the inline/worker peer branches both call the same `p2pSetup(...)` with the same boolean. "from the usage, it's indifferent" quoted.                                |
| D-4  | tests do not change                        | respected | doc only adds a config knob; no test surface touched.                                                                                                                                                                                                   |
| D-5  | no double code                             | respected | doc explicitly refuses to mirror or wrap boss's executor.                                                                                                                                                                                               |
| D-6  | minimal surface                            | partial   | core seam is one boolean forwarded — good. BUT the pre-condition checklist (§"pre-condition checklist") prescribes behaviour for boss's PR (item 1 favouring option (b), item 4 dictating "one knob, two callsites"). that is over-reach. see Findings. |
| D-7  | 2N+1, evm-per-peer orthogonal              | respected | doc names the four combinations and calls 2N+1 "the all-on combination".                                                                                                                                                                                |
| D-8  | push/pull on one channel                   | n/a       | W3/W4 territory.                                                                                                                                                                                                                                        |
| D-9  | loop-delay guard boss-shipped              | respected | not redesigned here.                                                                                                                                                                                                                                    |
| D-10 | no prod runtime changes from this plan     | respected | doc routes everything through existing `p2pSetup`; no new prod options claimed.                                                                                                                                                                         |

verdict on polymorphic-executor-verbatim: the doc honours the pattern. it does NOT redesign the executor and does NOT invent a parallel one. the only smell is prescribing the pre-conditions instead of waiting and observing.

---

## 2. findings

### MAJOR

- **W5 prescribes boss's PR shape via pre-conditions.** §"pre-condition checklist" item 1 explicitly states "(b) is the cleaner outcome" — that is W5 designing boss's factory boundary. item 4 ("one knob, two callsites, identical semantics") is also a design statement, not a verification. doc opener says "resist designing boss's PR for him"; the checklist then violates that. fix: replace prescriptive items with observe-and-record bullets — "record where the boolean lives once the PR lands; record the factory entry point". no preferences.

- **questions section ratifies a wire shape boss hasn't published.** §"questions to confirm with boss" item 1 names `InlineContractExecutor` / `WorkerContractExecutor` as if those are the chosen names. boss said the names are illustrative ("provisional until the PR lands" is acknowledged at the top, then promptly ignored). fix: drop the suggested names from the question — ask "what are the class names?" without proposing them.

- **"what this plan does NOT do" item: "no separate chain-instance manager on the harness".** good intent, but the parenthetical reasoning ("if hardhat is shareable across workers, boss's design already assumes it") is W5 speculating about boss's chain-sharing strategy. boss did not commit to a hardhat-sharing posture in the meeting. fix: state the refusal without speculating about boss's implementation.

### MINOR

- **discard list is solid but incomplete.** §"what to delete from v1 when boss's PR lands" covers `PortEip1193Provider`, `ChainBridge`, `PortJsonRpcProvider`, `*ChainProviderShim`, `*RpcAdapter`, `chainProviderFactory` opt. missing candidates from the v1 surface:

    - any `EvmHandle` / `EvmAdapter` / `ChainHandle` wrappers added on the worker side.
    - any `WorkerEvmBridge` or `EvmRpcKernel` (a second rpc kernel built only for evm calls — exactly the kind of thing boss's PR makes redundant).
    - any harness-level `chainPort` field on `PeerHandle` (if v1 added one to ferry chain calls).
    - `__tests__` covering executor-shim behaviour at the harness level.
      fix: append the missing candidates as a non-exhaustive bulleted list with "and anything else built to give a worker peer a chain handle outside boss's executor".

- **§"questions" item 4 conflates two concerns.** "does `WorkerContractExecutor` handle chain-instance sharing internally, or does the harness need to pass a chain handle / address through?" — the doc already asserts elsewhere the harness does nothing on chain access. asking it as an open question undermines that stance. fix: phrase as observation ("we assume executor handles its own chain access; confirm").

- **§"summary" overcommits.** "one boolean forwarded from `harnessConfig.dedicatedEvmThread` into `EvmStateMachine.p2pSetup`" names the config field and the callsite. that is fine for our side (W1/W2 own those), but reads as if we're committing boss's API. soften: "one boolean forwarded from our harness config through our existing `p2pSetup` callsite; whatever name boss picks on his side is what we read."

### NIT

- the title and intro use "(seam, not impl)" / "boss's evm-in-thread PR is not yet landed" — good. but the body then dives into reconstructed internals for half a page (§"what boss already built"). it's accurate but it's also the most likely place to drift into PR-design. recommend trimming to the three or four facts the seam actually depends on (polymorphic split exists, factory chooses, boolean opt-in, request/response by id) and dropping the rest.

- the four-combination matrix is mentioned in prose but never tabulated. one small table would make the orthogonality claim auditable.

- "(boss's boolean, name tbd)" appears once; elsewhere `dedicatedEvmThread` is used as if final. pick one — either always tbd, or commit to the name with a footnote.

---

## 3. verdict

**APPROVE-WITH-CHANGES.**

W5 gets the big call right — it refuses to redesign boss's polymorphic executor, refuses to mirror it on the harness side, and reduces the seam to one boolean passthrough. that is the entire point of this work item and it is intact.

the changes required are scope-pruning, not redesign: stop prescribing pre-conditions on boss's PR (MAJOR), stop ratifying class names boss hasn't published (MAJOR), broaden the discard list (MINOR), and trim speculation about boss's chain-sharing posture (MAJOR/MINOR border).

once those four edits are in, this is ready to sit and wait for boss's PR — which is exactly the posture W5 should be in.
