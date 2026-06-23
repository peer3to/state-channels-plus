## Repository Workflow

- Use `yarn` commands in this repository. Do not use `pnpm verify`.
- For post-edit validation, run the narrowest relevant test first when available.
- Run `yarn tsc --noEmit -p tsconfig.json` for TypeScript typechecking.
- Run `yarn compile` for compile-level validation when changes affect the build or exported package surface.

## Integration test harness

End-to-end tests drive real peers + chain + custom precompiles in-process via
`PeerTestHarness` (`test/fixtures/PeerTestHarness.ts`) — real signed blocks,
on-chain events, and transitions, not mocks. For the control surface (action
namespaces, the per-peer `harness.control(peer)` RPC services, and how to write
a scenario) see [docs/harness.md](docs/harness.md).

## Conventions

These are project rules to follow (and persist any future "remember this" instructions here).

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

### Comments

- Keep comments simple and to the point. No long essays.

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
- Never log with `console.*`. Use the internal logger (the one returned during `p2pSetup`); its output is collected and shipped for analysis, so `console.*` calls are invisible to that pipeline. This applies to main-thread code too. If a module has no logger in scope, thread one through its options/params rather than reaching for `console.*`.
