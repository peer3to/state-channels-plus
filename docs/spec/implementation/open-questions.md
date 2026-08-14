# Implementation Open Questions

> **Status:** Maintained current register.
> **Scope:** Unresolved implementation mechanisms, conformance, and platform behavior requiring engineer decisions.

Every question has one primary layer. Cross-layer effects remain links rather than duplicate entries.
Existing `OQ-*` IDs are preserved; new questions use the layer-scoped namespace documented in governance.

## Index

| ID                                               | Question                                                                                                                          | Source | Affected documents                                                                                                                                                                                    | Status             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| [`OQ-13-FE5CT4`](open-questions.md#oq-13-fe5ct4) | State proofs reject the intended mixed shape (milestones + non-final suffix)                                                      | Code   | [protocol/state-proofs.md](../specification/disputes/state-proofs.md), [protocol/finality.md](../specification/protocol-model/finality.md)                                                            | Open               |
| [`OQ-14-5C8KV7`](open-questions.md#oq-14-5c8kv7) | `reduce()` timeout fold: a dispute without a timeout can suppress a real timeout                                                  | Code   | [protocol/disputes.md](../specification/disputes/disputes.md)                                                                                                                                         | Partially resolved |
| [`OQ-15-2J4Y1Z`](open-questions.md#oq-15-2j4y1z) | Back-dated reduced-result timestamp makes `challengeDisputeReduction` unreachable                                                 | Code   | [protocol/disputes.md](../specification/disputes/disputes.md)                                                                                                                                         | Open               |
| [`OQ-17-6Z5Q0J`](open-questions.md#oq-17-6z5q0j) | Proxy fallback exposes the consumer facet's `deposit`/`withdraw` externally                                                       | Code   | [contracts/state-machine-base.md](./views/architecture/contracts/state-machine-base.md)                                                                                                               | Open               |
| [`OQ-19-Y8FDQX`](open-questions.md#oq-19-y8fdqx) | Channel-balance invariant not enforced on snapshot update or join                                                                 | Code   | [protocol/cross-layer-messages.md](../specification/settlement/cross-layer-messages.md)                                                                                                               | Open               |
| [`OQ-21-PEZK9X`](open-questions.md#oq-21-pezk9x) | `_tx.body` is never populated; no state-encoding version marker                                                                   | Code   | [concepts/state-machines.md](../specification/protocol-model/state-machines.md)                                                                                                                       | Partially resolved |
| [`OQ-22-99DDSZ`](open-questions.md#oq-22-99ddsz) | Inauthentic on-chain block calldata: escalation is signalled but no proof is built                                                | Code   | [sdk/block-confirmation-pipeline.md](./views/architecture/sdk/block-confirmation-pipeline.md), [security/open-security-review.md](../audit/security-assessment.md)                                    | Open               |
| [`OQ-23-SDBGYB`](open-questions.md#oq-23-sdbgyb) | SDK restart/recovery semantics: storage is fully in-memory                                                                        | Code   | [sdk/components.md](./views/architecture/sdk/components.md)                                                                                                                                           | Open               |
| [`OQ-24-A4XRTB`](open-questions.md#oq-24-a4xrtb) | `shouldSignBlock` refuses to sign an on-chain-posted block when the local node is next-to-write                                   | Code   | [protocol/finality.md](../specification/protocol-model/finality.md), [protocol/block-processing.md](../specification/block-progression/block-processing.md)                                           | Open               |
| [`OQ-25-E09XFR`](open-questions.md#oq-25-e09xfr) | Minor SDK lifecycle races: `abort()` residual queryability, TS snapshot-event ordering, kill/counter-dispute sequencing           | Code   | [sdk/architecture.md](./views/architecture/sdk/architecture.md), [sdk/components.md](./views/architecture/sdk/components.md), [sdk/dispute-pipeline.md](./views/architecture/sdk/dispute-pipeline.md) | Open               |
| [`OQ-30-2G0Q5M`](open-questions.md#oq-30-2g0q5m) | Chain-reorg handling and canonical per-channel event ordering in the SDK                                                          | Code   | [sdk/components.md](./views/architecture/sdk/components.md), [security/open-security-review.md](../audit/security-assessment.md)                                                                      | Open               |
| [`OQ-35-E5RRDF`](open-questions.md#oq-35-e5rrdf) | Handshake has no channel/identity binding — relay/reflection MITM; the signature is the whole root of trust                       | Code   | [sdk/rpc/handshake.md](./views/architecture/sdk/rpc/handshake.md), [security/trust-model.md](../specification/security/trust-model.md)                                                                | Open               |
| [`OQ-36-WEN9T1`](open-questions.md#oq-36-wen9t1) | `onDisputeAcknowledgmentRequest` never binds `channelId` to the local channel — cross-channel ack pollution and chain-read oracle | Code   | [sdk/rpc/is-fork-disputed.md](./views/architecture/sdk/rpc/is-fork-disputed.md)                                                                                                                       | Open               |
| [`OQ-37-0Y7YWS`](open-questions.md#oq-37-0y7yws) | Harness-control RPC root: unguarded, network-reachable, and published in the package                                              | Code   | [sdk/runtime-and-concurrency.md](./views/architecture/sdk/runtime-and-concurrency.md) §11.4, [security/open-security-review.md](../audit/security-assessment.md)                                      | Open               |

<a id="oq-13-fe5ct4"></a>

## OQ-13-FE5CT4 — State proofs reject the intended mixed shape

The intended model allows a proof of milestones (finality anchors) followed by a trailing
non-final suffix of signed blocks. The implementation rejects that combination:
`StateProofFacet` accepts milestones **or** a suffix, and forces suffixes to start at fork
genesis; the SDK's proof assembly mirrors this. Consequence: once any milestone exists, a
non-final suffix past the last anchor cannot be presented, so disputes may operate on a staler
state than designed. Comments in `ProofTypes.sol` and helper code describe the intended mixed
shape, so this looks like an implementation cut, not a decision. Confirm the intended shape and
extend the proof format, or amend the model. See
[protocol/state-proofs.md](../specification/disputes/state-proofs.md) §8.

<a id="oq-14-5c8kv7"></a>

## OQ-14-5C8KV7 — Empty-timeout fold can suppress a real timeout

`DisputeVerificationFacet.reduce()` folds timeouts by taking the minimum `blockHeight` without
checking `participant != address(0)`, so any committed dispute _without_ a timeout (height 0)
wipes a real timeout claim. This conflicts with the lowest-real-height rule tracked by [`OQ-9-XR1MFS`](../specification/open-questions.md#oq-9-xr1mfs).
Decide whether this is a bug (likely) or intended "any non-timeout dispute cancels the timeout"
semantics, then fix and test accordingly. See [protocol/disputes.md](../specification/disputes/disputes.md) §6.

**Partially resolved (2026-08-14, engineer decision):** a slash cancels a proposed timeout — a
reduction containing slashes intentionally applies no timeout
([`INV-DIS-7-9GGZSD`](../specification/disputes/disputes.md#inv-dis-7-9ggzsd)), so a
slash-carrying dispute suppressing the timeout candidate is intended and the fold's reset is
immaterial to the applied removals. The residual — whether a dispute with no slashes and no
timeout claim also cancels a real timeout — is a specification decision, tracked at the
specification layer in [`OQ-9-XR1MFS`](../specification/open-questions.md#oq-9-xr1mfs); whether
the fold must skip empty timeout structs follows that decision.

<a id="oq-15-2j4y1z"></a>

## OQ-15-2J4Y1Z — `challengeDisputeReduction` is currently unreachable

Every commit path back-dates `reducedResult.timestamp` by `evidenceTime`, so the reduce-challenge
period is already expired at commit and finalization is immediate (on-chain recomputation makes
the result objectively correct). Decide whether the challenge entry point is dormant scaffolding
for the intended optimistic-reduction design or should be removed. See
[protocol/disputes.md](../specification/disputes/disputes.md) §5.

The backdating is also inside the challenge-**replacement** path
itself — a successful challenge commits its replacement with
`block.timestamp - getEvidenceTime()`, so even if challenges become reachable, a replaced result
finalizes instantly and can never itself be challenged. Candidate rule: a replacement starts a
fresh `evidenceTime` challenge period at the replacement transaction's timestamp.

<a id="oq-17-6z5q0j"></a>

## OQ-17-6Z5Q0J — Consumer-facet functions are externally reachable

The proxy's fallback forwards every unmatched selector to the integrator's consumer facet, so
`deposit`/`withdraw` are directly externally callable; an unguarded `withdraw` implementation
would be drainable. Decide: a framework-level guard, or a documented integrator obligation with
review guidance. See [contracts/state-machine-base.md](./views/architecture/contracts/state-machine-base.md).

<a id="oq-19-y8fdqx"></a>

## OQ-19-Y8FDQX — Channel-balance invariant enforcement points

The aggregate balance invariant is currently checked only at spectate sync (client-side static
call) and via the `DisputeInvalidBalanceInvariant` fraud proof. It is not run on snapshot update
— despite a code comment declaring that intent — and not at on-chain join. Confirm and implement
the intended check sites, or record the omission as an accepted limitation with its risk. See
[protocol/cross-layer-messages.md](../specification/settlement/cross-layer-messages.md) §6. Pairs with [`OQ-11-38S3SE`](../specification/open-questions.md#oq-11-38s3se).

Additional unchecked site: at `open()`, the consumer facet's
`openChannelGenesis` return — the genesis state and participant list — is adopted without
cross-checking the participants against the joins that actually deposited and without a balance
check of the genesis state against total deposits. A buggy or hostile consumer can open a channel
whose membership does not match depositors.

<a id="oq-21-pezk9x"></a>

## OQ-21-PEZK9X — `_tx.body` population and state-encoding versioning

`AStateMachine.stateTransition` injects only `_tx.header`; `_tx.body` is never populated — decide
whether to populate it (making the full transaction visible to the machine) or remove it. See
[concepts/state-machines.md](../specification/protocol-model/state-machines.md) §2.1. Still open.

**Resolved (2026-08-10) — state-encoding versioning:** the state machine is immutable per
channel; upgrades to state-machine logic, if any, affect only newly opened channels. No
state-encoding version marker is needed, and an existing channel MUST NOT change its encoding.
Recorded normatively in [`REQ-SM-4-Z32M0W`](../specification/protocol-model/state-machines.md#req-sm-4-z32m0w) in
[concepts/state-machines.md](../specification/protocol-model/state-machines.md).

<a id="oq-22-99ddsz"></a>

## OQ-22-99DDSZ — Inauthentic on-chain calldata is not escalated

When a block delivered via a `BlockCalldataPosted` event fails authenticity checks — an objective
fault committed on-chain — `CalldataCommittedStrategy` signals escalation but builds no fraud
proof and opens no dispute (two code TODOs). The required proof type is unresolved. Feeds the
completeness review ([`OQ-5-4Q38M5`](../audit/open-questions.md#oq-5-4q38m5)). See
[sdk/block-confirmation-pipeline.md](./views/architecture/sdk/block-confirmation-pipeline.md) §4.1.

<a id="oq-23-sdbgyb"></a>

## OQ-23-SDBGYB — SDK restart and recovery semantics

All SDK storage domains are in-memory; a restarted participant has no persisted history and the
recovery procedure (resync from peers, from chain calldata, or via dispute) is unspecified. This
also bounds unbounded-memory growth over channel lifetime. See
[sdk/components.md](./views/architecture/sdk/components.md) (storage) and the watchtower assumption in
[security/trust-model.md](../specification/security/trust-model.md).

Related running-node case: when a still-participating node observes a
canonical `StateSnapshotUpdated` it does not know locally, there is no recovery-only mode — the
handler warns-and-ignores while spectating and, for an active participant, throws fatally after
one reduce attempt. The intended behavior (fetch from untrusted sources, verify against the
chain anchor, resume) needs an algorithm decision.

<a id="oq-24-a4xrtb"></a>

## OQ-24-A4XRTB — `shouldSignBlock` refusal when next-to-write

`StateManager.shouldSignBlock` refuses to sign an on-chain-posted block when the local node is
the next-to-write. The rule is not stated anywhere as intended protocol behavior; confirm intent
and specify it (or remove it). See [protocol/finality.md](../specification/protocol-model/finality.md) §8.

The counter-signing policy is now recorded normatively as
[`REQ-BLOCK-PIPE-10-PHAKE2`](../specification/block-progression/block-processing.md#req-block-pipe-10-phake2)
in [protocol/block-processing.md](../specification/block-progression/block-processing.md), with the
next-author refusal clause marked as this open decision.

<a id="oq-25-e09xfr"></a>

## OQ-25-E09XFR — Minor SDK lifecycle races

Grouped smaller items, each a code TODO or observed race: `abort()` disposes the manager graph
but not the runtime control port (residual queryability); the TypeScript
`onStateSnapshotUpdated` handler is not `(blockNumber, logIndex)`-ordered, unlike the
LocalDiamond mirror; and kill/counter-dispute sequencing (see [`OQ-1-NTJBA1`](../specification/open-questions.md#oq-1-ntjba1)). See
[sdk/architecture.md](./views/architecture/sdk/architecture.md), [sdk/components.md](./views/architecture/sdk/components.md), and
[sdk/dispute-pipeline.md](./views/architecture/sdk/dispute-pipeline.md).

<a id="oq-30-2g0q5m"></a>

## OQ-30-2G0Q5M — Chain-reorg handling and canonical event ordering

The SDK's event cursor is a bare block number (no block hash, transaction index, or log index),
so a same-height reorg is undetectable and there is no rollback journal; and chain logs dispatch
concurrently with no cross-log ordering, so any two same-channel events can apply out of
canonical order ([`OQ-25-E09XFR`](open-questions.md#oq-25-e09xfr) flagged one handler; the problem is general). Candidate rule: a canonical
`(blockNumber, blockHash, txIndex, logIndex)` cursor, one ordered application per channel, and
reorg rollback. Affects join, dispute, reduction, and withdrawal decisions — a reorg attack
surface the security review must cover. See [sdk/components.md](./views/architecture/sdk/components.md) and
[security/open-security-review.md](../audit/security-assessment.md). This supersedes the
event-ordering item of [`OQ-25-E09XFR`](open-questions.md#oq-25-e09xfr).

<a id="oq-35-e5rrdf"></a>

## OQ-35-E5RRDF — Handshake channel/identity binding (relay MITM)

The session handshake signs only `peer3:init-handshake:v1:<challengeHash>`. It binds nothing about
the transport, the session, or the two parties' identities, and no network transport
(Holepunch/WebRTC/local) authenticates its channel — so the handshake signature is the entire
root of trust for peer identity. An on-path attacker can forward a victim's live signature over
the initiator's random challenge and make the initiator believe it is authenticated to the victim
over the attacker's transport (relay/reflection MITM); the only limiter is the `agreementTime`
skew window. Decide the binding: include the two EVM identities and a transport/session binding in
the signed payload (EIP-712 or a domain-tagged struct), coordinated with [`OQ-29-EFY4NF`](../specification/open-questions.md#oq-29-efy4nf) (signature domains)
and [`OQ-34-FY08V2`](../specification/open-questions.md#oq-34-fy08v2) (protocol versioning) so one scheme covers all three. Until resolved, the trust model
MUST state that peer authentication assumes no on-path adversary between two honest peers — a
strong assumption for a p2p system. See [sdk/rpc/handshake.md](./views/architecture/sdk/rpc/handshake.md) §4.1 and
[security/trust-model.md](../specification/security/trust-model.md).

<a id="oq-36-wen9t1"></a>

## OQ-36-WEN9T1 — `is-fork-disputed` missing channel binding

`onDisputeAcknowledgmentRequest` never checks the request's `channelId` against the local
`stateManager.channelId`, and its chain fallback queries the shared manager contract. An attacker
who opens a throwaway channel and disputes it can get victims to acknowledge and permanently
record forks belonging to a foreign channel, and use the endpoint as a free chain-read oracle. The
duplicate-key check keys on `forkId` only, ignoring channel. Decide the channel-binding check and
the ack-record keying; also whether acks should be signed (see the documentation-debt note below).
See [sdk/rpc/is-fork-disputed.md](./views/architecture/sdk/rpc/is-fork-disputed.md) §6.6.

Related (documentation debt / decision pending): dispute acknowledgments are **unsigned**, so the
model doc's "building on an acknowledged dead fork is provably byzantine" overstates — the ack
record is local opinion, not portable fraud-proof evidence. Signed acks would connect
dead-fork building to the fraud-proof layer. And the three ack maps are never pruned; their
lifetime relative to fork finalization is undefined.

<a id="oq-37-0y7yws"></a>

## OQ-37-0Y7YWS — Harness-control surface exposure

The test harness registers `HarnessControlRpc` as an ordinary custom-RPC root: **11 services, 207
public endpoints, zero guards** (`ARpcService.guards` defaults to `[]` and no harness service
overrides it). Because service resolution is structural over any transport, any peer connected to
a harness-built peer can invoke them — including `scenario.exec`, which rebuilds a supplied source
string with `new Function` and runs it against the live `StateManager` (arbitrary code execution in
the host realm), `handshake.signMessage` (a signing oracle), and `signer` (imports other peers'
private keys). The root also ships: `tsc` emits `dist/test/fixtures/customRpc/harnessControl/`,
`package.json` `files` includes `dist`, and `exports["./test-harness"]` re-exports it, so it is the
default root for any downstream consumer building peers with the harness.

Today the blast radius is bounded only by production `p2pSetup` registering the bare
`MainRpcService`. Decide: restrict harness services to the trusted loopback transport and exclude
them from the published artifact ([`REQ-RUN-10-FSD184`](views/architecture/sdk/runtime-and-concurrency.md#req-run-10-fsd184)'s intended rule), or accept "test peers only run on
closed networks" as an explicit, documented limitation. See
[sdk/runtime-and-concurrency.md](./views/architecture/sdk/runtime-and-concurrency.md) §11.4. This is a production gate.
