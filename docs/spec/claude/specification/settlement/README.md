# System 4 — Cross-Layer Messaging and Settlement

> **Agent status:** Maintained system contract (non-normative navigation; normative authority lives in
> the owned documents below).
> **Engineer verification:** Pending.

This system moves value and membership between the base layer and the channel: deposits, joins,
top-ups, inbound-message inclusion, outbound effects, exits and withdrawals, snapshot adoption, range
proofs, consumer asset accounting, and the exact incremental processing rules on both the same-fork
and successor-fork paths. It also owns the channel lifecycle from opening to settlement and the
spectate-before-join admission flow.

## System contract

- **Owned state.** The two ordered cross-layer streams (inbound: base layer → channel; outbound:
  channel → base layer), their committed tips and cumulative totals, the channel's aggregate balance
  accounting, and the lifecycle position of every participant (spectating, joining, member, exited).
- **Public inputs.** Base-layer deposit/join transactions and their acknowledgement events; outbound
  messages produced by state transitions; finality proofs or reduced successor forks that advance the
  on-chain snapshot; spectator synchronization requests.
- **Public outputs.** Inbound message blocks for block authors to include; verified sync payloads for
  spectators; snapshot-advance submissions with their proven outbound ranges; released withdrawals
  through the consumer asset adapter.
- **Calls.** Enforcement (open, join/top-up, snapshot updates, incremental outbound processing);
  protocol model (stream/snapshot commitments, balance algebra); disputes (forced inclusion when
  cooperative inclusion stalls); peer communication (join-signature collection, sync serving).
- **Called by.** Block progression (fetches due inbound messages during block construction); disputes
  (reduction outputs commit stream tips and emit exit messages); runtime (lifecycle orchestration).
- **Trust and availability assumptions.** The base layer is the source of truth for deposits and
  stream tips; chain observation freshness per the trust model; the channel-balance invariant is
  checkable before any participant relies on a synchronized state.
- **Ordering and concurrency.** Both streams are hash-linked and totally ordered; processing is
  incremental over proven ranges and must give the same result in any batch split
  ([cross-layer-messages.md](./cross-layer-messages.md)).
- **Invariants (owned).** `REQ-MSG-*`, `INV-MSG-*` ([cross-layer-messages.md](./cross-layer-messages.md));
  `REQ-LIF-*` ([lifecycle.md](./lifecycle.md)).
- **Failure and recovery outcomes.** Spectating is fail-closed (`REQ-MSG-9`); a stalled inbound
  inclusion is recoverable through the forced-inclusion dispute input; a failed snapshot advance
  leaves the previous snapshot authoritative; withdrawals cannot exceed deposits (`INV-MSG-4`).
- **Resource bounds.** Proven ranges are bounded by gas and calldata limits; batch splitting keeps
  each submission within deployable bounds without changing the result.
- **Verification evidence.** Requirement matrices in the owned documents; the settlement edges are
  proven under [`REQ-IX-3`](../interactions.md#req-ix-3) and
  [`REQ-IX-6`](../interactions.md#req-ix-6).

## Owned documents

| Document | Defines |
| --- | --- |
| [cross-layer-messages.md](./cross-layer-messages.md) | The mirror-image ordered streams, stream commitments, incremental withdrawal processing, spectate-before-join, join admission, and the channel-balance invariant. |
| [lifecycle.md](./lifecycle.md) | Opening, the two-transaction minimum lifecycle, the two paths to a snapshot-updating state, and settlement. |

## Interaction contracts

Producer of the snapshot-adoption edge into enforcement
([`REQ-IX-6`](../interactions.md#req-ix-6)); consumer of inbound-inclusion service from block
progression ([`REQ-IX-3`](../interactions.md#req-ix-3)) and of reduced successor forks from disputes.
