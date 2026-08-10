# Decision register and unresolved design work

## Status and use

This file contains only decisions that are genuinely unresolved, accepted requirements not yet implemented, and deferred research. It does not weaken requirements already settled in the specification review.

An accepted requirement is normative even when current code violates it. A pending decision is non-normative until an engineer approves one option and the owning chapter is updated.

## 1. Status vocabulary

| Status                | Meaning                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `accepted / missing`  | Design is settled; implementation or evidence is incomplete.         |
| `decision required`   | Two or more materially different designs remain possible.            |
| `research`            | Not needed for V1 unless product scope changes.                      |
| `blocked by decision` | Implementation should not continue until the named decision is made. |

Every decision record must end with an owner, approval date, chosen option, rationale, affected requirement, migration impact, and required evidence. Removing a record before those fields are copied to the owning chapter is not allowed.

## 2. Accepted requirements that are not open questions

The following points came from the specification review and are treated as design input:

| ID     | Accepted requirement                                                                                                                                                     | Current status                                              | Owning chapters                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `A-01` | Engineers approve design authority and source-of-truth changes. Documentation records intent and code differences.                                                       | Documented; approval process still needs use.               | [Governance](./governance.md)                                               |
| `A-02` | The specification is top-down: system, protocol, contracts, SDK, integration, security, verification, then reference.                                                    | Implemented in this tree.                                   | [Specification root](./README.md)                                           |
| `A-03` | The system targets small multiparty channels and starts with full-mesh peer communication.                                                                               | Documented.                                                 | [Network topology](./protocol/network-topology-and-trust.md)                |
| `A-04` | Safety assumes at least one non-Byzantine observer with data and chain access in every relevant partition.                                                               | Documented; watchtower implementation missing.              | [Security](./security.md)                                                   |
| `A-05` | Objective cryptographic faults are separate from ordinary offline or network failure. Subjective reputation never becomes slash evidence.                                | Documented; attribution audit remains.                      | [Security](./security.md)                                                   |
| `A-06` | Off-chain execution is continuous. Blocks need not pause for an explicit unanimous vote after every transition. Later linked signatures may contribute virtual finality. | Implemented in part; formal model missing.                  | [Execution and finality](./protocol/execution-and-finality.md)              |
| `A-07` | A state proof may contain finalized milestones followed by a linked nonfinal signed suffix.                                                                              | Current contract and SDK contradict it.                     | [State proofs](./contracts/state-proofs-and-finality.md)                    |
| `A-08` | Membership changes require proof anchors that make the controlling signer set unambiguous.                                                                               | Partial implementation/evidence.                            | [Execution and finality](./protocol/execution-and-finality.md)              |
| `A-09` | Joining follows spectate, verify, deposit, pending inbound, and state-machine inclusion. Deposit alone does not grant active membership.                                 | Partial implementation.                                     | [Spectating and joining](./sdk/spectating-and-joining.md)                   |
| `A-10` | Inbound and outbound messages are generic ordered streams. An outbound exit is not a direct off-chain consumer call.                                                     | Implemented for core types; custom stream coverage missing. | [Messages and settlement](./protocol/messages-membership-and-settlement.md) |
| `A-11` | Dispute recovery combines four inputs: latest valid state, latest inbound head, chain slashes, and timeout/self-removal.                                                 | Implemented in part.                                        | [Disputes](./protocol/disputes-and-fraud-proofs.md)                         |
| `A-12` | The latest valid history carries into a successor even when it lacks direct finality.                                                                                    | Partial; mixed proof defect blocks intended behavior.       | [Reduction](./contracts/reduction-and-snapshots.md)                         |
| `A-13` | Across competing valid timeout claims, the earliest timeout point wins. Slash has precedence over timeout or self-removal for the same participant.                      | Implemented in part; adversarial evidence missing.          | [Reduction](./contracts/reduction-and-snapshots.md)                         |
| `A-14` | Every opened dispute window must reach one deterministic successor.                                                                                                      | Missing for all commitments killed.                         | [Dispute lifecycle](./contracts/dispute-lifecycle.md)                       |
| `A-15` | Protocol storage must be durable, atomic, restart-safe, and reorg-aware. In-memory stores are test/development adapters.                                                 | Current SDK contradicts it.                                 | [Storage and crash recovery](./sdk/storage-and-crash-recovery.md)           |
| `A-16` | Network processing needs method-specific byte, work, concurrency, queue, and rate limits.                                                                                | Outer caps exist; full policy missing.                      | [Runtime and networking](./sdk/runtime-and-networking.md)                   |
| `A-17` | Target-chain runtime bytecode limits are hard release gates. Test-only unlimited size cannot hide them.                                                                  | Current artifacts contradict it.                            | [Contract architecture](./contracts/architecture-and-storage.md)            |
| `A-18` | Contract and SDK time rules use explicit chain-compatible formulas and boundary behavior.                                                                                | Formulas documented; skew/reorg policy unresolved.          | [Protocol time](./protocol/time-and-data-availability.md)                   |

Implementation work for these items does not need a new design decision unless it encounters a conflict that changes the stated intent.

## 3. Protocol and reduction decisions

### `D-01`: Equal-height state tie-break

**Status:** decision required.

**Question:** when two valid dispute candidates have the same `transactionCnt`, which deterministic rule selects one?

**Current behavior:** the contract chooses the candidate with the numerically smaller block hash.

**Options:**

1. Keep smaller block hash. It is deterministic and cheap, but its safety and incentive effects need proof.
2. Prefer a candidate with stronger confirmation evidence. This may better represent support but makes reduction and proof comparison more complex.
3. Declare same-height distinct valid candidates slashable equivocation and exclude both or select by earlier chain commitment. This requires evidence and a successor rule when evidence is incomplete.

**Decision criteria:** deterministic contract/SDK result, no benefit from grinding transaction encoding, compatibility with virtual votes and membership changes, bounded gas, and a clear fraud target.

**Required evidence:** model generated forks with every evidence order, confirmation shape, and block-hash ordering.

### `D-02`: Successor when all dispute commitments are killed

**Status:** blocked by decision; V1 release blocker.

**Question:** what state becomes the successor when fraud proofs remove every commitment in an opened window?

**Current behavior:** no complete terminal algorithm exists.

**Options:**

1. Fall back to the disputed fork's last on-chain snapshot plus eligible chain inputs.
2. Open a bounded replacement-evidence phase and reduce the replacement set.
3. Allow any participant to submit a fully audited fallback proposal, with a new response window.

**Required properties:** one successor, no deadlock, no reward for killing all data, preservation of pending deposits and eligible exits, bounded deadlines, and safe behavior if membership becomes empty.

**Required evidence:** Solidity, SDK, and E2E cases where commitments are killed in every order, including the final commitment at the deadline.

### `D-03`: On-chain slash consumption

**Status:** decision required; V1 release blocker.

**Question:** may a dispute select a subset of eligible on-chain slashes, or must reduction include all eligible slashes before its cutoff?

**Review intent:** the dispute supplies a subset of eligible chain slashes.

**Current behavior:** the reducer automatically includes all eligible slashes before the cutoff, then unions values supplied by disputes.

**Subset model tradeoff:** a successor can choose which punishments to apply. This may support staged recovery but risks omission, inconsistent fork state, and repeated applicability.

**Include-all model tradeoff:** successor state is less discretionary and cannot omit known slashes, but unrelated or late-recorded slash entries may affect a fork that did not expect them.

**Decision must define:** channel/fork scope, cutoff, canonical order, duplicate handling, already-removed participants, retention, replay across descendants, and precedence over other removals.

### `D-04`: Dispute fraud-proof economics

**Status:** decision required; V1 release blocker.

**Current behavior:** a valid dispute fraud proof kills the dispute and slashes its disputer. An invalid eligible proof can slash the proof sender. Malformed or reverting inputs need exact treatment.

**Questions:**

- Is slashing the disputer always correct, or can responsibility belong to a signer whose data the disputer relayed?
- What bond or stake makes permissionless disputing safe without deterring honest recovery?
- Does an invalid proof lose stake only when objectively false, or also when malformed?
- Who receives slash value, and how is it represented in application balance?

**Decision criteria:** objective attribution, resistance to spam, no penalty for mere data unavailability, consumer-asset compatibility, and simple on-chain verification.

### `D-05`: Hash-only dispute availability

**Status:** blocked by decision; V1 release blocker.

**Question:** what happens when a commitment is present on chain but a verifier cannot obtain or decode the dispute or its required final anchor?

**Current behavior:** SDK audit can stop without a fireable proof when state proof bytes are undecodable or the required local anchor is absent.

**Options:** mandatory calldata, a bounded data-request phase, availability proof, or exclusion of unauditable candidates. Silent acceptance is not an option.

**Required evidence:** missing bytes, bad ABI, unknown milestone, withholding by all but one peer, chain-only observer, and restart without private cache.

### `D-06`: Proof and audit bounds

**Status:** decision required; V1 release blocker.

Set maximum values for milestones, block confirmations, signed suffix blocks, signatures per object, inbound/outbound message blocks, messages per block, disputes per window, fraud proofs per call, auditing bytes, and state-machine replay gas.

Bounds must come from target-chain calldata/gas measurements and client CPU/memory tests. A global 16 MiB transport cap is not a proof bound.

### `D-07`: Reducer eligibility

**Status:** decision required.

**Current behavior:** the intended eligibility check is commented out, so entry-point behavior does not enforce it consistently.

**Options:**

1. Anyone may reduce after the evidence window. Add economic anti-spam and make reducer identity informational.
2. Only a deterministic eligible participant may reduce first, followed by a permissionless fallback.
3. Threshold-signed fast reduction with permissionless fallback after delay.

The decision must define fairness, censorship recovery, fee incentive, and challenge timing.

### `D-08`: Challenge replacement timestamp

**Status:** decision required; current behavior unsafe.

**Current behavior:** successful challenge replacement can retain a backdated reduction timestamp, shortening or eliminating a fresh response period.

**Preferred direction:** start a new `evidenceTime` challenge period at the replacement transaction timestamp. A shorter rule is acceptable only with a proof that no new participant or output needs review.

**Required evidence:** replacement just before and after each deadline, repeated replacement attempts, chain reorg, and a previously offline honest observer.

## 4. Time and chain-observation decisions

### `D-09`: Clock and skew policy

**Status:** decision required; V1 release blocker.

**Current behavior:** `Clock` estimates from up to ten recent chain blocks. There is no approved maximum skew, safety lag, periodic resync interval, deep-reorg rule, or provider-disagreement rule.

**Decision must define:**

- timestamp unit and equality boundaries;
- maximum local estimate error tolerated for signing and action scheduling;
- conservative margin before submitting deadline transactions;
- sampling window and outlier handling;
- resync cadence;
- chain reorg rollback;
- behavior when providers disagree or stop advancing;
- whether a node stops producing when time confidence is low.

### `D-10`: RPC provider trust reduction

**Status:** decision required.

**Options:** one configured provider under an explicit trust assumption, multiple-provider comparison for critical reads, or a light-client/verified-RPC design. V1 may choose the first, but the failure guarantee and operator warning must be explicit.

### `D-11`: Watchtower protocol

**Status:** blocked by decision; V1 safety operation incomplete.

Define who may act, what is signed, which data is supplied, how the delegate stays synchronized, what assets pay gas, how authorization is revoked or rotated, privacy and retention, availability target, transaction fee policy, and what happens when the delegate fails.

The minimum E2E scenario is an offline honest participant whose delegate detects invalid chain state and submits the correct proof before deadline.

### `D-12`: Data-availability cost policy

**Status:** decision required.

Measure normal and adversarial block publication and dispute-audit calldata. Decide who pays, when the protocol may batch, and what maximum cost a participant accepts before opening. Cost shifting to one honest observer is a denial-of-service vector, even if funds remain safe.

## 5. Membership and stream decisions

### `D-13`: Deposit that never becomes active membership

**Status:** decision required.

**Question:** after a join deposit is accepted but never included in a valid successor, how does the depositor recover?

**Options:** forced inclusion, refund after a chain deadline, or a successor rule that converts the pending deposit into an immediate outbound return. The result must handle reorgs and consumer transfer failure.

### `D-14`: Partial outbound processing

**Status:** decision required.

Choose whether one call processes an outbound range atomically or may commit a prefix when a later message fails. Prefix processing lowers retry cost but requires exact next-height semantics and per-message consumer failure classification.

The decision must cover custom message types, reentrancy, duplicate calls, transaction replacement, and an external consumer that succeeds then returns malformed data.

### `D-15`: Channel with no remaining participants

**Status:** decision required.

Define terminal snapshot, remaining balance destination, pending inbound value, unresolved outbound value, slash proceeds, dispute data retention, and who can submit final cleanup when membership becomes empty.

### `D-16`: Unknown on-chain snapshot recovery

**Status:** accepted recovery requirement; algorithm decision required.

A still-included participant may observe a canonical snapshot it does not have locally. It must enter recovery-only mode, fetch from untrusted sources, verify chain anchor and proof, and resume without accepting one peer's unchecked state.

Choose multi-source policy, data limits, timeout, watchtower involvement, and what happens when no source can provide bytes.

## 6. Networking and topology decisions

### `D-17`: Method-specific RPC resource policy

**Status:** decision required; V1 release blocker.

For every RPC method define request bytes, response bytes, object counts, concurrent calls, work units, queue priority, timeout, cancellation, and per-peer/global rate. Recovery and dispute traffic may need priority over ordinary block gossip.

Penalties must distinguish malformed authenticated abuse, repeated valid expensive requests, and ordinary slow/unavailable peers.

### `D-18`: Supported full-mesh participant limit

**Status:** decision required.

The initial product target is a small table, roughly six players and perhaps up to ten. Confirm a hard supported maximum using bandwidth, signature, EVM replay, spectator sync, and recovery benchmarks. Contracts and RPC must reject unsupported larger channels rather than degrade without bound.

Alternative topologies are research until the product requires them.

### `D-19`: Session and signature domain versioning

**Status:** decision required.

Define the signed domain for blocks, joins, open proposals, disputes, and handshakes. It should bind protocol version, chain, manager deployment, channel, object type, and session where appropriate without breaking on-chain verification cost.

Migration must preserve old proof verification until all old channels close.

## 7. Contract architecture decisions

### `D-20`: Deployable facet architecture

**Status:** blocked by decision; V1 release blocker.

Current proxy, local diamond, and two facets exceed or approach the runtime-size limit. Choose:

- a complete Diamond selector registry with smaller facets;
- multiple explicit verifier contracts called by a smaller manager;
- shared libraries plus versioned verifier addresses;
- another architecture that deploys on the target chain.

The choice must define selector ownership, initialization, authorization, storage roots, upgrade/migration, emergency action, local-diamond parity, and ABI generation.

### `D-21`: Upgrade authority and storage migration

**Status:** decision required.

Decide whether V1 deployments are immutable. If upgradeable, define authority, delay, participant notice, opt-out/exit, facet compatibility, storage version, migration proof, rollback, and old-proof verification.

An undocumented deployer key is not an upgrade policy.

### `D-22`: `onlySelf` and internal call boundary

**Status:** depends on `D-20`.

Current self-call restrictions separate external entry points from internal composition. Preserve or replace them only after selector routing, reentrancy, and proxy identity are fixed. Tests must show external callers cannot reach privileged internal verification or mutation paths.

### `D-23`: Replay state restoration versus stateless verification

**Status:** decision required before final gas architecture.

Current verification writes/restores state around application replay. Compare it with transient storage, a separate verifier instance, or stateless application proofs. Evaluate gas, reentrancy, storage corruption on revert, local/on-chain parity, and application compatibility.

## 8. Implementation defects with settled direction

These are not design choices:

| ID     | Defect                                                               | Required direction                                                       |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `B-01` | Contract rejects state proof containing milestones and suffix.       | Implement `A-07`.                                                        |
| `B-02` | SDK proof builder discards suffix when a milestone exists.           | Implement `A-07`.                                                        |
| `B-03` | Expired empty evidence window can receive new evidence.              | Reject all evidence after the window close rule is met.                  |
| `B-04` | Challenge replacement can inherit a backdated timestamp.             | Apply `D-08` after approval; do not silently retain expired review time. |
| `B-05` | Dispute commitment kill uses swap-with-last and changes order.       | Canonicalize before reduction or prove/order-test independence.          |
| `B-06` | Event cursor lacks block hash, transaction index, and log index.     | Implement canonical ordered journal and reorg rollback.                  |
| `B-07` | Event dispatch can apply logs concurrently out of order.             | Apply one canonical order per channel/deployment.                        |
| `B-08` | `OutboundMessagesProcessed` is not dispatched by current event sync. | Add idempotent mirror handling.                                          |
| `B-09` | SDK protocol stores are volatile.                                    | Implement `A-15`.                                                        |
| `B-10` | Join is locally marked pending before canonical event observation.   | Stage request; promote on canonical event.                               |
| `B-11` | Spectator may blacklist a peer for any request failure.              | Separate invalid evidence from unavailability and transport error.       |
| `B-12` | Contract runtime artifacts exceed target-chain limits.               | Resolve `D-20` and enforce build gate.                                   |
| `B-13` | Deployment helper defaults protocol times to zero.                   | Require explicit nonzero production values.                              |
| `B-14` | Reducer eligibility check is disabled.                               | Resolve `D-07`, then make every entry point consistent.                  |

## 9. Future work

These items are not V1 requirements unless product scope changes:

- non-full-mesh routing for large participant groups;
- randomly sampled or privacy-preserving watchtower networks beyond the minimum delegate design;
- subjective reputation for discovery and peer selection only;
- alternative data-availability layers;
- L2/L3 partitions with different finality and fee assumptions;
- threshold or aggregate signatures;
- confidential application state and zero-knowledge fraud/replay schemes;
- leader selection other than deterministic round-robin;
- optimistic threshold-signed reduction fast path after the baseline path is safe;
- formal light-client verification inside each SDK node.

Any research item promoted into V1 must define its trust, privacy, liveness, compatibility, and cost changes before code work begins.

## 10. Decision template

Use this record when resolving an item:

```text
Decision ID:
Status: accepted | rejected | deferred
Owner:
Approved by:
Date:
Chosen behavior:
Alternatives rejected:
Rationale:
Security and economic impact:
Compatibility and migration:
Owning specification sections:
Implementation changes:
Required unit/property/E2E evidence:
Release gate:
```

After approval, update the owning chapter first, add the implementation difference and evidence, then reduce this entry to a link to the accepted decision or remove it in the same reviewed change.
