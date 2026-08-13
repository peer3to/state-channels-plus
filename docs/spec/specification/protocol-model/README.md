# System 1 — Protocol Model and Commitments

> **Agent status:** Maintained system contract (non-normative navigation; normative authority lives in
> the owned documents below).
> **Engineer verification:** Pending.

This system defines the shared vocabulary every other system builds on: participants, channel and fork
identity, blocks and signatures, snapshots, canonical encoding, finality and virtual voting,
message-stream heads, and the chain-time model. It owns the invariants that make two independent
implementations agree on *what a thing is* before any mechanism operates on it.

## System contract

- **Owned state.** None at runtime — this system owns definitions and identities: channel id, fork id
  (hash of the fork's genesis snapshot data), block/confirmation structure, snapshot structure and its
  commitment fields, canonical struct encoding, participant identity, balance algebra, and protocol
  time derived from chain time.
- **Public inputs.** Encoded protocol structs produced by any system; chain timestamps for the time
  model.
- **Public outputs.** Identity and commitment rules (`forkId`, block hash, snapshot hash,
  `stateMachineStateHash`), the finality verdict for a block given signatures and history, the
  authorized next author, and chain-time validity verdicts for timestamps.
- **Calls.** Nothing — this system is the leaf every other system depends on.
- **Called by.** Every other system: block progression executes state machines and compares
  commitments; disputes verify state proofs against finality and encoding rules; settlement commits
  stream heads into snapshots; enforcement recomputes the same commitments on-chain; peer
  communication moves the canonical encodings across the wire.
- **Trust and availability assumptions.** Unforgeable signatures, collision-resistant hashing,
  deterministic state-machine replay, and an observable chain clock within the skew bounds of
  [time.md](./time.md).
- **Ordering and concurrency.** Definitions are order-free; the time model defines the only ordering
  primitive here (chain-time monotonicity and tolerance windows).
- **Invariants (owned).** `INV-ID-*`, `REQ-ID-*` ([identity.md](./identity.md));
  `INV-HIST-*`, `REQ-HIST-*` ([history-and-commitments.md](./history-and-commitments.md));
  `INV-SM-*`, `REQ-SM-*`, `REQ-BAL-*` ([state-machines.md](./state-machines.md));
  `REQ-FIN-*`, `INV-FIN-*` ([finality.md](./finality.md)); `REQ-TIME-*`, `INV-TIME-*`
  ([time.md](./time.md)); `REQ-DATA-*` ([data-types.md](./data-types.md)).
- **Failure and recovery outcomes.** A violated definition is not recoverable by retry: mismatched
  commitments, invalid encodings, and equivocating signatures are objective evidence consumed by the
  disputes system, never silently repaired.
- **Resource bounds.** Canonical encodings must be bounded and enumerable
  ([state-machines.md](./state-machines.md) [`REQ-SM-2-PHCRFR`](state-machines.md#req-sm-2-phcrfr)–[`REQ-SM-4-Z32M0W`](state-machines.md#req-sm-4-z32m0w)); proof and snapshot sizes bound the
  systems that carry them.
- **Verification evidence.** Each owned document carries its black-box test matrix; cross-system
  evidence for the commitment and finality edges is defined in
  [../interactions.md](../interactions.md).

## Owned documents

| Document | Defines |
| --- | --- |
| [identity.md](./identity.md) | Participant identity and signing: key control as identity, recoverable signatures over canonical targets, normalized comparison, confined signing authority, domain-separated signing forms. |
| [data-types.md](./data-types.md) | Neutral wire/domain structs, canonical encoding, balance algebra. |
| [state-machines.md](./state-machines.md) | Deterministic application state machines: injected execution context, serialization, participants, turn-taking, balances. |
| [history-and-commitments.md](./history-and-commitments.md) | Blocks, snapshots, fork identity, the commitment hierarchy, message-stream heads. |
| [finality.md](./finality.md) | Signatures as non-equivocating votes, virtual voting, milestones, the three finality routes, deterministic authoring. |
| [time.md](./time.md) | Chain time as the authoritative clock, skew/bias configuration, timestamp validation rules. |

## Interaction contracts

This system is the producer side of the execution/commitment edge
([`REQ-IX-2-2PY2EF`](../interactions.md#req-ix-2-2py2ef)) and the timing authority every window computation cites.
Consumers must not redefine identities or commitments locally; a divergent local definition is a
conformance defect, not an alternative interpretation.
