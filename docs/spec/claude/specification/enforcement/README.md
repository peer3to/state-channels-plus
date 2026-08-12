# System 6 — On-Chain Enforcement

> **Agent status:** Maintained system contract (non-normative navigation; normative authority lives in
> the owned documents below).
> **Engineer verification:** Pending.

This system is the base-layer authority: the channel manager, its module composition and storage
domains, routing, consumer adapters, contract-side entry points, authorization, on-chain state
transitions, event contracts, upgrade/migration constraints, and deployment-size constraints. It
executes what the other systems prove; it never originates protocol decisions of its own.

## System contract

- **Owned state.** Per channel: the adopted snapshot, processed inbound/outbound stream tips and
  cumulative totals, block-calldata commitments, the slash set, dispute windows and reduced results,
  escrowed assets behind the consumer adapter, and timing configuration.
- **Public inputs.** Signed transactions invoking the externally visible operations inventoried in
  [contracts.md](./contracts.md): opening, joins/top-ups, calldata posting, snapshot updates, fraud
  proofs, dispute operations, and views.
- **Public outputs.** Events (channel opened, inbound processed, calldata posted, dispute lifecycle,
  snapshot advanced) that every observing node treats as authoritative; released withdrawals; view
  results.
- **Calls.** The integrator's state machine and consumer adapter — deterministic replay and asset
  custody are delegated behind fixed interfaces defined by the protocol model.
- **Called by.** Settlement (lifecycle and snapshot adoption), disputes (adjudication operations),
  block progression (calldata publication), and every node's chain observation.
- **Trust and availability assumptions.** The base chain provides deterministic execution, ordering,
  and finality; deployment platform limits (code size, gas, calldata) constrain decomposition but
  never weaken validation (`REQ-CONTRACT-ARCH-4`).
- **Ordering and concurrency.** The chain serializes all inputs; protocol results must nevertheless
  be order-independent where the owning system requires it (dispute reduction, incremental range
  processing).
- **Invariants (owned).** `INV-CONTRACT-ARCH-1`, `REQ-CONTRACT-ARCH-*`
  ([contracts.md](./contracts.md)). The *semantics* each operation enforces are owned by the
  invoking system's documents and cross-linked from the operation inventory.
- **Failure and recovery outcomes.** Every public operation fails atomically; a rejected submission
  leaves prior state authoritative; internal-only operations reject direct external invocation
  (`REQ-CONTRACT-ARCH-3`).
- **Resource bounds.** Mainnet code-size budget per deployable module, gas-bounded proof and
  reduction inputs, and calldata-bounded evidence (`REQ-CONTRACT-ARCH-4`,
  [../security/data-availability.md](../security/data-availability.md)).
- **Verification evidence.** The requirement matrices in the owned documents below; the
  adjudication and settlement edges are proven under [`REQ-IX-5`](../interactions.md#req-ix-5) and
  [`REQ-IX-6`](../interactions.md#req-ix-6); the observation edge under
  [`REQ-IX-7`](../interactions.md#req-ix-7); local/on-chain equivalence under
  [local-mirror.md](./local-mirror.md).

## Owned documents

Like every system, enforcement decomposes into modules, each with its own responsibility, owned
storage domain, entry points, assumptions, and constraints. [contracts.md](./contracts.md) owns the
rules that hold *across* modules; each module document owns its boundary and maps operation
semantics to their owning protocol systems without restating their algorithms.

| Document | Module responsibility |
| --- | --- |
| [contracts.md](./contracts.md) | Composition and adjudication architecture: single logical state, shared validation, internal-call confinement, deployment integrity, and the external operation inventory mapping every operation to its invoking system. |
| [admission-and-funds.md](./admission-and-funds.md) | Everything entering the channel: opening, join/top-up, deposit custody through the consumer adapter, inbound-stream append. |
| [snapshot-adoption.md](./snapshot-adoption.md) | Everything leaving the channel: the canonical snapshot, both advance paths, incremental outbound processing, withdrawal release. |
| [proof-verification.md](./proof-verification.md) | The side-effect-free verification predicates every other module and the local mirror share. |
| [dispute-window.md](./dispute-window.md) | Dispute windows on-chain: upload bookkeeping, throttles, commitment-exact reduction, challenge, kill. |
| [fraud-slashing.md](./fraud-slashing.md) | Fraud-proof application and the append-only on-chain slash set. |
| [execution-and-consumer.md](./execution-and-consumer.md) | Contract-side deterministic replay and the consumer-adapter delegation boundary. |
| [local-mirror.md](./local-mirror.md) | Dual execution: the same contract logic as the client's local check engine and read cache — equivalence constraints, unconditional sync, cache-never-authority with RPC fallback. |

## Interaction contracts

Consumer end of [`REQ-IX-5`](../interactions.md#req-ix-5) (dispute adjudication) and
[`REQ-IX-6`](../interactions.md#req-ix-6) (snapshot adoption); producer of the chain-observation edge
[`REQ-IX-7`](../interactions.md#req-ix-7) that feeds every node. The [local mirror](./local-mirror.md)
is how consumers of `REQ-IX-7` avoid re-querying the chain for every read without ever trusting the
cache as authority.
