# Data Availability

> **Status:** Draft, reverse-engineered baseline with recorded engineer decisions applied. Pending approval.
> **Scope:** How the protocol guarantees that block data needed for recovery and disputes can be
> obtained, what that guarantee costs, and its griefing exposure. Sibling documents:
> [trust-model.md](./trust-model.md), [open-security-review.md](./open-security-review.md).

## 1. Purpose & observable contract

Every recovery path — disputes, timeouts, state proofs, late synchronization — depends on the
relevant block data being obtainable. The protocol's answer in version one is **chain-backed data
availability**: when p2p delivery cannot be relied on, block data is anchored on the chain itself,
so the chain is the guarantor that the required data can be obtained.

This avoids adding a separate data-availability trust assumption: the only DA dependency is the
same live, honest, final chain the protocol already assumes (A1 in
[trust-model.md](./trust-model.md)). The observable contract is:

- Any participant can commit a signed block on-chain via calldata posting (§2).
- Any participant can, when required, obtain the data behind any commitment relevant to a dispute,
  because posting the commitment publishes the full signed block as calldata in the posting
  transaction.
- No third-party DA network, committee, or storage provider is trusted.

**The trade-off is material, and this is one of the WEAKEST parts of the current design** — not an
incidental detail. Posting costs fees, slows recovery, and extends on-chain waiting time in the
uncooperative case (§3–§5). The design intentionally pays these costs to avoid a new trust
assumption; alternatives that reduce them introduce new assumptions and are Future Work.

## 2. Block-calldata publication

Implementation:
[`StateChannelManagerProxy.postBlockCalldata`](../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol).

Mechanics (Current):

- The caller submits a full `SignedBlock` plus a `maxTimestamp` race-condition guard
  (`block.timestamp <= maxTimestamp` or the call reverts).
- The contract persists only a single commitment,
  `keccak256(abi.encode(signedBlock, block.timestamp))`, keyed by
  `(channelId, msg.sender, forkId, transactionCnt)`. The full block travels as calldata and is
  recoverable from the transaction, not from contract storage.
- A commitment is **non-overwritable**: reposting for the same key reverts
  (`ErrorBlockCalldataAlreadyPosted`).
- `msg.sender` MUST be the block's author (`ErrorBlockCalldataMsgSenderNotBlockAuthor`).
- The block's signature is NOT verified at posting time. The sender takes responsibility for the
  data: if the posted `SignedBlock` is junk, a fraud proof can slash the sender by verifying the
  junk against the commitment. A non-participant sender is ignored by peers and simply pays fees.
- The `BlockCalldataPosted` event carries the full signed block and the posting timestamp;
  clients ingest it through the event pipeline
  ([src/StateChannelEventListener.ts](../../../../src/StateChannelEventListener.ts),
  [src/stateManager/EventSyncService.ts](../../../../src/stateManager/EventSyncService.ts)).

**INV-DA-1.** A posted block-calldata commitment MUST be immutable for its key and binding: the
commitment either matches the calldata-published signed block and posting timestamp, or it is
objective evidence against the poster.

**REQ-DA-1.** Block data referenced by any dispute-relevant commitment MUST be obtainable from the
chain alone (calldata of the posting transaction). No separate DA trust assumption is permitted in
version one.

## 3. Timing windows and the extra on-chain time grant

The protocol defines four on-chain configured windows
([contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol](../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol),
defaults in seconds: `p2pTime = 15`, `agreementTime = 5`, `chainFallbackTime = 30`,
`evidenceTime = 30`; deployments configure their own values):

- **`p2pTime`** — the window for ordinary p2p delivery and production of the next block.
- **`agreementTime`** — the additional window for collecting unanimous agreement (signatures)
  off-chain.
- **`chainFallbackTime`** — the additional window granted to fall back to the chain: post block
  calldata (or otherwise act on-chain) when p2p plus agreement time expired without detecting
  unanimous agreement.
- **`evidenceTime`** — the dispute-window evidence/kill period; also serves as the first-block
  grace term in timeout deadlines ([../protocol/disputes.md](../protocol/disputes.md)).

Where the extra time is granted (Current):

- **Timeouts.** A participant may be timed out only after
  `previousTimestamp + [evidenceTime if first block] + p2pTime + agreementTime + chainFallbackTime`
  ([`DisputeFraudProofFacet._timeoutDeadline`](../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol)).
  The author therefore always has the on-chain fallback window before silence becomes a timeout.
- **Block timestamps.** The `InvalidTimestamp` fraud proof measures a block's timestamp against
  `p2pTime` from its parent — but if the parent was posted as block calldata, the **on-chain
  posting timestamp replaces the parent's claimed timestamp** as the reference point
  ([`FraudProofFacet._hasInvalidTimestamp`](../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol)).
  Posting on-chain thus objectively re-anchors "when the data became available" and grants the
  next author fresh time from that anchor. A participant who already signed the parent forfeits
  this extra time (the forfeit-of-extra-time rule: its signature proves earlier possession).

**REQ-DA-2.** The specification of any timing-sensitive rule MUST state which of these windows it
consumes and when the on-chain re-anchoring applies. Why extra time exists: without it, a
participant who never received data p2p could be timed out or fraud-proven using data it provably
never had; the calldata post makes availability objective and restarts the clock from an
observable chain event.

**Open question:** the exact intended relationship between `agreementTime` and `chainFallbackTime`
consumption in each SDK escalation path (which component waits which window before posting) is
implemented across
[src/stateManager/StateManager.ts](../../../../src/stateManager/StateManager.ts) and
[src/stateManager/ValidationService.ts](../../../../src/stateManager/ValidationService.ts) but not
yet specified precisely; it must be reverse-engineered into
[../sdk/block-confirmation-pipeline.md](../sdk/block-confirmation-pipeline.md) and confirmed by an
engineer.

## 4. Costs: fees, latency, and user experience

The costs of chain-backed DA are structural, not incidental:

- **Fees.** Every calldata post is an on-chain transaction. Persisting one hash is cheap in
  storage, but the calldata itself and base transaction costs are paid per post, per participant
  who needs to retain progress.
- **Latency.** Recovery through the chain waits for `chainFallbackTime`-scale windows and chain
  inclusion instead of p2p round trips. When peers do not cooperate, the granted extra on-chain
  time directly worsens user-visible responsiveness.
- **UX is a first-class design constraint.** The target is fast, cheap, and ideally free
  operation. Any proposed optimization of this subsystem MUST be evaluated against: user-visible
  latency (ordinary and worst case), ordinary-case cost, worst-case griefing cost, and any new
  trust assumptions it introduces (REQ-DA-4).

## 5. Calldata-commitment griefing

The kill period and self-slashing deter **objectively invalid** behavior: a participant who posts
junk data, submits an invalid dispute, or files a bogus fraud proof loses stake
([../protocol/fraud-proofs.md](../protocol/fraud-proofs.md),
[../protocol/disputes.md](../protocol/disputes.md)).

Calldata commitments have a different, unsolved problem: **protocol-valid non-cooperation is not
punishable but still imposes costs on everyone else.**

**A non-cooperating participant can force every other participant to post block calldata to retain
progress and data availability.** By simply not signing, not delivering p2p, or delaying to the
window edges — none of which is objectively provable misbehavior — it pushes peers onto the chain
fallback. Virtual voting and the rest of the protocol preserve eventual progress, but:

- the channel becomes slower (chain-scale latency replaces p2p latency);
- every participant bears posting costs, including the instigator;
- the cost is potentially **asymmetric**: in a six-party channel, one instigator incurs one
  posting cost while causing five peers to incur their own posting costs each.

**REQ-DA-3.** This griefing exposure is a deliberate version-one limitation and MUST be stated
plainly wherever chain-backed DA is described. It MUST NOT be presented as a solved anti-spam
mechanism: kill period and self-slashing deter objectively invalid submissions; they do not remove
the cost of protocol-valid non-cooperation.

**REQ-DA-4.** Any change to the DA design MUST be evaluated against: user-visible latency,
ordinary-case cost, worst-case griefing cost, and new trust assumptions, and MUST preserve the
safety and recovery model.

## 6. Verification

- **Contract behavior:** unit tests for `postBlockCalldata` — non-overwritability, author-only
  sender, `maxTimestamp` guard, commitment binding (junk posting slashed via fraud proof), event
  contents. Current coverage lives in the contract suites under [test/](../../../../test).
- **Window semantics:** tests that the timeout deadline sums the specified windows and that the
  `InvalidTimestamp` proof switches its reference to the on-chain posting timestamp when a
  commitment exists, including the forfeit-of-extra-time case.
- **Griefing scenarios:** e2e scenarios in which one participant withholds cooperation and peers
  recover through calldata posting; measure and assert eventual progress. A cost-accounting
  (fee-asymmetry) test does not exist — `none — gap`.
- **Recovery from chain data alone:** a test that a client reconstructs required blocks purely
  from posted calldata/events with p2p unavailable.

## Future Work

_Non-normative._

- **Better DA approaches** that reduce calldata cost and recovery latency. Candidates: the
  web-of-trust model planned for a later version; alternative DA layers; running channels on
  smaller/cheaper L2 or L3 partitions so posting is cheap. Each proposal MUST state its new trust,
  security, availability, privacy, and fee assumptions explicitly and preserve a clear safety and
  recovery model (REQ-DA-4).
- **Optimistic reduction / commitment-only paths** that keep full data off-chain unless a
  challenge forces publication (see the wider optimistic-commitment direction in
  [../protocol/disputes.md](../protocol/disputes.md) Future Work).
- **Griefing-cost rebalancing**: mechanisms that shift fallback costs toward the party that caused
  the fallback, if attribution can be made objective without punishing honest unavailability.

## Traceability

| ID       | State          | Statement                                                                                      | Implementation                                                                                                                                                                                                                             | Verification evidence                                                                                            |
| -------- | -------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| INV-DA-1 | Design pending | Calldata commitments are immutable per key and binding on the poster.                          | [`postBlockCalldata`](../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol)                                                                                                                                      | Contract suites under [test/](../../../../test)                                                                  |
| REQ-DA-1 | Design pending | Dispute-relevant block data obtainable from the chain alone; no separate DA trust assumption.  | `postBlockCalldata` + `BlockCalldataPosted` event ingestion ([src/stateManager/EventSyncService.ts](../../../../src/stateManager/EventSyncService.ts))                                                                                     | e2e recovery scenarios in [test/](../../../../test); no p2p-fully-unavailable reconstruction test — `none — gap` |
| REQ-DA-2 | Design pending | Timing rules state which windows they consume; on-chain posting re-anchors timing objectively. | [`FraudProofFacet._hasInvalidTimestamp`](../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol), [`DisputeFraudProofFacet._timeoutDeadline`](../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol) | Fraud-proof timing tests under [test/](../../../../test)                                                         |
| REQ-DA-3 | Design pending | Calldata griefing exposure stated plainly as a version-one limitation.                         | Design property (this document)                                                                                                                                                                                                            | Griefing e2e scenarios exist; cost-asymmetry accounting — `none — gap`                                           |
| REQ-DA-4 | Design pending | DA changes evaluated against latency, cost, griefing cost, and new trust assumptions.          | Process requirement (this document + [governance.md](../governance.md) change loop)                                                                                                                                                        | `none — gap` (process, no automated evidence)                                                                    |
