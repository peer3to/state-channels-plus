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

### E2E parallel run logs

`yarn test:e2e:parallel` writes each run to a fresh `./logs/run-N/` (N
auto-increments) and never touches earlier `run-*` dirs — error logs persist
across runs for comparison (`TEST_FAILURES.md` workflow). Only the current
run's dir is cleared/cleaned. An explicit `--logDir <dir>` is used (and
cleared) as-is; dirs outside `./logs` additionally need
`--allow-logdir-purge`. Prune old `run-*` dirs manually when done comparing.

### Testing changes to `src/`

Every `src/` change ships with tests in the same pass — both kinds:

- **Unit tests** for the isolated logic (no mocks, no junk data — see
  `test/AGENTS.md`: factory-built domain objects, or a teleported harness
  session when the component has collaborators).
- **E2E tests** when the change affects peer-observable behavior (new
  guard/punishment/queue semantics, protocol deviations, sync flows).

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

### Comments

- Keep comments simple and to the point. No long essays.
- When refactoring or moving code (extracting a method, moving a body to another
  file/service), carry over all original comments verbatim — do not drop or
  condense them, including large explanatory/strategy blocks and numbered step
  comments. If a comment genuinely needs to change, call it out rather than
  dropping it silently; flag stale commented-out dead code instead of removing
  it without mention.

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
