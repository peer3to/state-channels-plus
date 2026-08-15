## Repository Workflow

- Use `yarn` commands in this repository. Do not use `pnpm verify`.
- For post-edit validation, run the narrowest relevant test first when available.
- Run `yarn tsc --noEmit -p tsconfig.json` for TypeScript typechecking.
- Run `yarn compile` for compile-level validation when changes affect the build or exported package surface.
- Don't disturb the user's working tree or index to inspect another revision.
  Prefer a throwaway worktree (`git worktree add <tmp> <ref>`) over `git stash`.
  If you must stash, preserve staging: restore with `git stash pop --index` so
  files the user had staged come back staged — never leave them re-reviewing
  files they'd already staged.

## Conventions

These are project rules to follow (and persist any future "remember this" instructions here).

### PR reviews (AI agents)

When reviewing a PR, verifying adherence to **all** guidelines in this file
_and_ `test/AGENTS.md` (for anything under `test/`) is part of the review —
report violations as findings alongside correctness issues. This includes the
testing-changes rule above (unit + e2e in the same pass), the strategy-pattern
rules, the type-safety rules, and the test-harness rules (no mocks, fixtures
trigger src code).

### Specification traceability

For any design, source, contract, or test change that affects specified
behavior, follow `docs/spec/AGENTS.md` in the same pass. Identify affected
requirements, planned tests, matching implementation subjects and source inventories, conformance traceability,
test traceability, individual test declarations, questions, findings, and audit
approvals. Planned tests preserve the owning requirement ID, for example
`INV-DA-1.T1`; exact tests map to permutation IDs such as `INV-DA-1.T1.P1`. Update all affected layers, rerun related evidence, and
preserve the forward-only subject chain: neutral `specification/A`, concrete
`implementation/A`, then evidence-owning `verification/A`. Verification has
only its overview and the specification/implementation traceability matrices;
exact test links and coverage judgments belong in those rows. Regenerate all
six inverse reports with `yarn spec:refresh` (the command never authors the
maintained subject documents). Before a commit run
`yarn spec:impact` and `yarn spec:impact --staged`; during PR review run
`yarn spec:impact --base <merge-base-ref>` and semantically recheck every
reported path. PR reviews report specification drift,
missing mirrors or links, stale approvals, incomplete black-box/system matrices,
unclear test names, and unresolved decisions as findings. Agents must not edit
the engineer-owned approvals register or invoke its approval command. Linked
changes make the aggregate approval `Reverification required` automatically;
ask the engineer for clarification only when intent, an oracle, or risk is
uncertain, and leave final fingerprint approval to the engineer.

### Canonical test command and parallel run logs

`yarn test:parallel` is the canonical full test gate and runs all Mocha tests;
pass `--e2e-only` to limit discovery to `test/e2e`. The legacy in-process
`yarn test` command is only for rare focused compatibility checks. The parallel
runner writes each run to a fresh `./logs/run-N/` (N
auto-increments) and never touches earlier `run-*` dirs — error logs persist
across runs for comparison (`TEST_FAILURES.md` workflow). Only the current
run's dir is cleared/cleaned. An explicit `--logDir <dir>` is used (and
cleared) as-is; dirs outside `./logs` additionally need
`--allow-logdir-purge`. Prune old `run-*` dirs manually when done comparing.

### Test timeouts

- **Never set `this.timeout(...)` in a test.** The global `timeout` in
  `.mocharc.json` governs every test. A per-test override is acceptable only when
  a measurement proves that one test needs longer, and the measurement belongs in
  the PR description.
- Never add one pre-emptively "to be safe" -> it gets copy-pasted onto every
  neighbouring test, and then nothing catches a test that has genuinely gone slow.
- A test that does not fit the global timeout is doing too much: split it or slim
  its setup instead of raising its ceiling.
- A load flake is not a reason for a per-test bump. The parallel runner re-runs
  tasks it starved, and a starved task carries the starvation signature
  (watchdog / event-loop-delay / `exit null`), not a real timeout.
- Hook budgets are separate: the `this.timeout(...)` calls in
  `test/harness/session/registerTestSessionHooks.ts` size session reset and the
  detached-promise drain, not a test.

### Test-chain RPC mutations

- **Never call node-wide test RPC methods from a test that may share its node or
  slot with another test.** This includes `evm_increaseTime`, `evm_mine`,
  `evm_setNextBlockTimestamp`, snapshot/revert, automine/interval-mining changes,
  `hardhat_mine`, `hardhat_reset`, impersonation, balance mutation, and similar
  endpoints. They mutate global node state and can corrupt unrelated concurrent
  tests.
- Such methods are allowed only when the test owns a provably isolated node for
  its entire lifetime. Do not infer isolation from the current command or from
  tests usually running serially; verify it from the runner/provider setup.
- Prefer exercising behavior through normal transactions and the harness. If an
  isolated-node mutation is unavoidable, keep it in an explicitly isolated
  test runner and restore reversible settings in `finally`.

### Testing changes to `src/`

Every `src/` change ships with tests in the same pass, at the appropriate
layers:

- **Unit tests treat the component as a black box through its public surface.**
  Cover every meaningful component-level variation: normal and no-op paths,
  both sides of boundaries, valid and invalid/missing state, failures,
  retry/recovery, and relevant concurrency/interleavings. Use no mocks or junk
  data — see `test/AGENTS.md`: use factory-built domain objects, or a
  teleported harness session when the component has collaborators.
- **E2E tests cover how that black box interacts with other systems.** For
  peer-observable changes (guard/punishment/queue semantics, protocol
  deviations, sync flows), test each affected integration boundary and
  representative end-to-end success, failure, recovery, and race workflow.
  Do not duplicate every unit-level input or boundary permutation in E2E.
  Separate E2E cases are required only when a variation changes observable
  system behavior, crosses a different integration boundary, or exercises a
  materially different system interaction.

Verify with the narrowest targeted run (`--grep` the touched files) before
handing off.

### RPC services (`*Service` + `*RpcMethods`)

Applies to `src/rpc/services/*` and `test/fixtures/customRpc/**`.

- A `*RpcMethods` class must contain **only the public endpoint functions**. At
  runtime `private` does not exist, and the dispatcher routes by name
  (`methods[rpc.method](...)`), so any method on a `*RpcMethods` instance — even
  a `private` one — is callable by a crafted payload.
- All helpers, accessors (e.g. `sm`/`storage` getters), and shared state belong
  on the corresponding `*Service` (it is not routable). Endpoints reach them via
  `this.service.*`. The service is where services coordinate shared state.
- Each service lives in its own directory: `<name>/<Name>Service.ts` +
  `<name>/<Name>RpcMethods.ts`.

### Block-validation deviations go through the strategy

Applies to `src/stateManager/validationStrategy/*` and their call sites
(`StateManager.onBlockConfirmation`, `tryMergeStoredBlockConfirmation`,
`ValidationService`).

- **Every deviation from the happy path is a method on `AValidationStrategy`**
  (e.g. `notAllSingersAreParticipants`, `invalidStateTransitionDetected`,
  `wrongGenesisDetected`). Never handle a deviation inline at the call site —
  no matter how obvious the handling seems. Two reasons: (1) the strategy
  interface is the single place to see all deviations; (2) the correct side
  effect differs per pipeline (live gossip disconnects/blacklists; dispute
  replay produces fraud-proof evidence against the submitter; spectating
  drops the feed).
- **Side effects live inside the strategy implementations**, not at the call
  site. The call site only computes the inputs (pass precomputed sets — e.g.
  the unexpected signers/signatures — so strategies don't recompute), calls
  the hook, logs, and interprets the returned `BlockValidationResult`
  (`SUCCESS` = continue the pipeline).
- When adding a deviation, implement it on **all** strategies — a deliberate
  `throw` ("should not be relevant/called") is a valid implementation when the
  deviation is impossible for that pipeline.
- **The pipeline's unit of work is the `QueuedBlockEntry`, never a bare
  block + ad-hoc sender parameter.** Entries are CRDTs: copies merge
  (signatures + signature -> source attribution) in `QueueStorage` until
  scheduled, then the dequeued entry executes atomically and converges
  through storage. Strategies resolve offenders from `entry.signatureSources`
  / `entry.sourcePeers` and re-queue via `restoreEntry` so attribution
  survives the not-ready cycle. Struct-only callers (dispute replay, spectate
  sync) enter via `onBlockConfirmationStruct`, which wraps into a sourceless
  entry.

### Class layout

- **All fields at the top, then all methods** — a class is always `{ fields,
methods }`. Never interleave a field declaration between methods. When adding a
  new field, put it with the other fields at the top of the class (keep any
  explanatory comment with it), not next to the method that happens to use it.

### Comments

- Keep comments simple and to the point. No long essays.
- When refactoring or moving code (extracting a method, moving a body to another
  file/service), carry over all original comments verbatim — do not drop or
  condense them, including large explanatory/strategy blocks and numbered step
  comments. If a comment genuinely needs to change, call it out rather than
  dropping it silently; flag stale commented-out dead code instead of removing
  it without mention.

### Logging metadata

- Reusable log-metadata extraction belongs in `LoggerUtils`, alongside the
  existing block, dispute, transport, RPC, and contract-call helpers. Call
  sites should delegate to those helpers instead of assembling selectors,
  addresses, byte lengths, or other structured log metadata ad hoc.

### Reuse existing code

- Search for an existing implementation before adding logic. When the same
  operation already exists, reuse it or extract one shared implementation;
  never copy-paste the behavior into another class or service.
- Keep one owner for each operation. Callers should delegate to that owner
  instead of maintaining parallel implementations that can drift.

### Solidity validators shared with the off-chain TS pipeline

- A check that must agree on- and off-chain (dispute fraud-proof handlers) lives
  **once in Solidity**; TS calls it via typechain — never re-implement it in TS
  (it drifts → the off-chain pipeline builds a proof the on-chain apply handler
  rejects). Must run on **both the calldata and non-calldata dispute paths**.
- **Placement:** pure (no state) → free fn in `utils/DisputeUtils.sol` /
  `BlockUtils.sol` + a `LocalDiamond` forwarder. State-reading domain logic →
  `public` on the owning facet (e.g. `StateProofFacet`) + a
  `StateChannelManagerProxy` forwarder + a `StateChannelManagerInterface` decl;
  TS calls `stateChannelManagerContract.<fn>.staticCall(...)`, other facets
  `delegatecall` the facet address (see `isCorrectLatestState`,
  `areSignedBlocksLinkedAndVerified`). Broadly-shared primitive → `public` on
  `StateChannelCommon` (`isBlockAuthentic`).
- **Never put domain logic `public` on `StateChannelCommon`:** a `public` base fn
  is in every facet's ABI → compiled into all of them. `internal` is
  dead-code-eliminated to its callers.

### Platform-specific code (node / browser)

- **Any platform-specific file must live under the platform dir** — `.../node/…`
  or `.../browser/…` — never at a shared path. `tsconfig.json` excludes the
  `browser` dirs and `tsconfig.browser.json` excludes the `node` dirs, so a
  node-only file (anything importing `node:fs`, `node:perf_hooks`,
  `node:worker_threads`, `child_process`, etc.) never compiles into or bundles
  for the browser build, and vice versa. Introducing a platform feature at a
  shared path leaks that platform's APIs into the other build — don't.
- **A shared (or browser-compiled) file must not import a platform-only module
  directly.** Route it through a `@platform/*` alias with a node impl and a
  browser impl (the browser one can be a no-op), wired in the `paths` of _both_
  `tsconfig.json` and `tsconfig.browser.json`. Note `.../worker/` dirs are shared
  (browser-compiled) unless explicitly excluded — treat them as shared.
- **Validate both builds** after platform changes:
  `yarn tsc --noEmit -p tsconfig.json` **and**
  `yarn tsc --noEmit -p tsconfig.browser.json`.

### Type safety

- **Primitive collection types need domain meaning.** Plain `string`, `number`,
  `boolean`, and similar generic primitives are usually not descriptive enough
  as `Map` keys/values or `Set` members. Prefer a descriptive alias such as
  `EventKey`, `ChannelKey`, or `BlockNumber`. A primitive may be used directly
  only when a concise comment immediately above the collection explains
  exactly what its keys and values represent.
- When mirroring another type's signatures (e.g. event listeners that mirror
  handler methods), derive them with mapped/`infer` types so they stay in sync,
  rather than hand-restating loosely-typed signatures.
- **Reuse the real types; no unnecessary casting.** Never write `as unknown as
{ ... }` structural shapes that re-state an existing type. Reach the real type
  instead: type the entry point so the concrete type flows through. E.g. a
  harness-control `*Service`/`*RpcMethods` should declare its `p2pManager` as
  `P2PManager<HarnessControlRpc>` (via the `ARpcService`/`ARpcMethods`
  `TP2PManager` param) — then `localRpc`/`remoteRpc` are fully typed (the SDK's
  own services included) with no casts. Generic helpers should be generic over
  their args (e.g. `execOnHost<T, A>(…, args: A)`) so call sites are checked
  rather than funnelled through `Record<string, unknown>` + `as never`.
- Casts are only acceptable for genuinely untyped/private internals (e.g.
  monkey-patching a private SDK member in a stub) — not for public, already-typed
  surfaces.
- **No `Awaited<ReturnType<...>>` wrappers for types that have a name.** If a
  method returns `Promise<ReduceData>`, write `ReduceData` — import/export the
  named type instead of deriving it through utility-type gymnastics. Derived
  types are only for signatures that must mirror another surface (first bullet).
- **Name `Codec`/ethers-encoded values `encoded*`.** When a field or variable
  holds an ABI/`Codec.encode`d hex string (e.g. crossing the runtime port),
  name it `encodedDispute`/`encodedSyncPayload`/… — bare `string` isn't
  descriptive enough to signal it must be `Codec.decode`d before use. This
  applies to RPC params too: name them `encodedBalanceA`/`encodedBlock`, never
  `a`/`encodedA`.
- **Return encoded values inside a named-field object, not bare.** An RPC method
  that returns an encoded value must return `{ encodedBalanceDelta }` /
  `{ encodedSnapshot } | null` / `{ encodedDisputes }` — never a bare `string` /
  `string[]` — so the consumer sees what it's getting (and must decode). Bare
  encoded returns hide intent; wrap them.
- **Encode _every_ ethers/typechain struct crossing the RPC port — don't
  hand-check for bigints.** If a `*RpcMethods` endpoint takes or returns a
  `*Struct` (`BlockConfirmationStruct`, `StateProofStruct`, `SignedBlockStruct`,
  `BalanceStruct`, …), it crosses as a `Codec.encode`d `encoded*` value, not the
  raw struct. Two failure modes motivate the blanket rule: a bigint field throws
  at `JSON.stringify`, and a `BytesLike` field that is a `Uint8Array` clones to a
  corrupt object — both avoided by encoding. Add a `Codec.Type` for the struct if
  one doesn't exist (the `*EthersType` usually already does).
- **Never shim `BigInt.prototype.toJSON`.** A raw bigint reaching
  `JSON.stringify` must throw (a contract violation), not coerce to a lossy
  number — that throw is the backstop that surfaces a missed encoding.
- **Don't introduce a named type for a one-off.** If a type would be used in a
  single place and isn't an exported/reused contract, just use the implicit
  (inferred) type — drop redundant return annotations and let inference flow.
  Keep it simple; add a named type later only if it actually earns reuse. (And
  don't reach for `Awaited<ReturnType<…>>`-style gymnastics to avoid a name —
  that's worse than the type it replaces; it's for generics, not one-offs.)
- Never log with `console.*`. Use the internal logger (the one returned during `p2pSetup`); its output is collected and shipped for analysis, so `console.*` calls are invisible to that pipeline. This applies to main-thread code too. If a module has no logger in scope, thread one through its options/params rather than reaching for `console.*`. Exception: `scripts/` CLIs (test runners, infra tooling) write their user-facing output with `console.*` by design — the rule governs `src/` and harness code whose logs must ship through the pipeline.
