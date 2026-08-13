# Time Model

> **Agent status:** Maintained reverse-engineered draft.
> **Engineer verification:** Pending.
> **Status:** Draft; pending engineer verification.
> **Scope:** Defines the implementation-neutral time model behavior, assumptions, constraints, security properties, and black-box test plan.
> **Related:** [../concepts/state-machines.md](./state-machines.md) (`_tx.header.timestamp`
> is the only time a state machine may read),
> [../concepts/history-and-commitments.md](./history-and-commitments.md) (where
> timestamps live in the data model), [disputes.md](../disputes/disputes.md) (timeout reduction),
> [fraud-proofs.md](../disputes/fraud-proofs.md) (`InvalidTimestamp` enforcement),
> [../security/trust-model.md](../security/trust-model.md) (RPC trust behind chain reads).

## Contents

- [Purpose and authoritative chain time](#1-purpose-and-authoritative-chain-time)
- [Estimated chain time: the Clock](#2-estimated-chain-time-the-clock)
- [Timing windows are configuration trade-offs](#3-timing-windows-are-configuration-trade-offs)
- [Authoring timestamps](#4-authoring-timestamps)
- [From local impression to objective claim](#5-from-local-impression-to-objective-claim)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Requirements and invariants](#requirements-and-invariants)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## 1. Purpose and authoritative chain time

**Purpose & observable contract.**

- **REQ-TIME-1** — The connected blockchain's time is authoritative for the protocol. Local wall
  clocks are not a source of truth: no protocol decision (timeout, timestamp validity, window
  expiry) may rest on a wall-clock reading that has not been anchored to chain time.

Every timing rule in the system is ultimately expressed against chain-observable quantities:
block timestamps of the underlying chain, timestamps carried in signed protocol artifacts
(transaction headers, snapshots), and the on-chain observation times bound into
`postBlockCalldata` commitments. A participant's wall clock is only an implementation aid for
estimating chain time between chain reads.

**Assumptions & dependencies.** Chain time is only as good as the participant's view of the
chain: an unavailable, lagging, or dishonest RPC endpoint skews the estimate. This is part of the
RPC trust assumption ([../security/trust-model.md](../security/trust-model.md)), not a separate
one.

## 2. Estimated chain time: the Clock

Each participant tracks an **estimated chain time** and uses it as its local protocol clock.

- The local protocol clock is `wallClock + clockAdjustmentSeconds`
  (`Clock.getTimeInSeconds()`).
- On initialization (`Clock.init`, called once at runtime-host start
  (P2pRuntimeHost) and again only if the
  provider is replaced), `syncClock`:
    1. Reads the latest block and computes
       `difference = latestBlock.timestamp − (wallClock + adjustment)`.
    2. Computes `averageBlockTime` over up to the last 10 blocks
       (`(latest.timestamp − past.timestamp) / n`, `n = min(height, 10)`).
    3. If `|difference| > averageBlockTime`, adds the full `difference` to the adjustment and
       re-syncs recursively until the estimate is within one average block time of the chain head
       timestamp (or, when `averageBlockTime` is 0 on a fresh chain, adopts the difference
       directly).
- `Clock.getBlockchainTime()` bypasses the estimate and reads the chain head directly; the off-chain participant
  uses it where an authoritative read is worth an RPC round trip (e.g. before join deadlines in
  JoinChannelService, and to
  double-check apparent timeouts in participant state manager).

**Bias and lag, by construction.** The estimate is aligned to the chain head's _timestamp_, which
itself trails real time by up to roughly one block interval, and the sync tolerance is one
average block time. The estimate therefore deliberately runs behind wall-clock "now" and is only
accurate to a band of about one block interval. This lag is a feature for safety-side decisions
(a participant is less likely to falsely judge a peer late) and a cost for responsiveness.

- **REQ-TIME-2** — Each honest participant MUST keep its local protocol clock within the
  specified skew bound of chain time, normally by estimating from recent block timestamps.
  Timing windows (§3) are dimensioned assuming this bound holds for honest participants.

**Open question:** the sync tolerance factor is unresolved in the unresolved design
(`TODO - think - should it be 2* or 1*` in Clock.syncClock): should
the re-adjustment trigger be one average block time, two, or a fixed bound independent of block
time?

**Open question:** For this protocol version: the clock syncs once per session (at init and on provider
replacement) and is never re-synced periodically. Wall-clock drift, chain block-time changes, and
reorganizations during a long session are not corrected. Is a periodic or event-driven re-sync
(e.g. on each observed chain block) required, and with what cadence?

**Open question:** there is no explicitly specified **maximum clock skew** number for honest
participants. The protocol requires "within about one average chain block time of the chain
head timestamp", and the protocol windows (§3) absorb the rest. An explicit bound, chosen and
validated empirically, is required before the timing model can be declared complete.

## 3. Timing windows are configuration trade-offs

Four windows are fixed at manager deployment
(StateChannelManagerProxy
deployment configuration; mirrored in the off-chain participant as
`TimeConfig`):

| Window              | Default (s) | Role                                                                                                                              |
| ------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `p2pTime`           | 15          | How far a block's timestamp may advance past its predecessor's relevant timestamp; the per-turn authoring budget.                 |
| `agreementTime`     | 5           | How long peers subjectively allow for a block to arrive and gather signatures before treating the p2p path as stalled.            |
| `chainFallbackTime` | 30          | Extra budget to reach the chain (post calldata) once the p2p path has stalled.                                                    |
| `evidenceTime`      | 30          | Dispute evidence window; also granted as extra grace to a fork's first block (`firstBlockGrace`: height 0 gets `+ evidenceTime`). |

These are deliberate trade-offs, not derived constants. Tighter windows improve responsiveness
and shorten the exposure to stalling peers, but raise the false-failure rate under network delay,
block-timestamp variation, and clock skew; looser windows reduce false failures but slow every
time-dependent recovery path (timeouts, disputes, settlement).

- **REQ-TIME-3** — Deployments MUST treat the window values and the clock-skew bound as explicit
  configuration with the trade-off above; the windows MUST be large relative to the maximum
  honest clock skew and the chain's block-time variance.

**Open question:** the default values (15/5/30/30 seconds) are development defaults and have not
been empirically validated under representative delay, skew, reorganization, and block-production
conditions. Exact production values are unresolved.

## 4. Authoring timestamps

When authoring, the off-chain participant stamps the transaction header with the estimated chain time
(`timestamp: Clock.getTimeInSeconds()` in
LocalP2pSigner.sendTransaction), then clamps it
into the objectively valid range before signing
(the corresponding participant-state operation):

- at least the local estimate plus 1 second of execution allowance,
- at least the previous block's (or genesis snapshot's) timestamp (monotonicity),
- at most `previousRelevantTimestamp + firstBlockGrace + p2pTime` (the objective ceiling, §5.2).

An honest author with a correctly synced clock therefore cannot produce a timestamp that is
objectively invalid; the clamp converts clock error into using the boundary value instead.

## 5. From local impression to objective claim

A participant's immediate judgment that an event is "on time" or "late" is **local and
fallible**: it depends on its own estimated clock and on when the network delivered the event. A
recorded timestamp becomes an **objective protocol claim** only when it is validated against the
chain-time rules and tolerances below — rules whose inputs (signed predecessor timestamps,
snapshot timestamps, on-chain posting times) any party and the chain itself can check.

- **REQ-TIME-4** — Every timeout, fraud proof, and slashing condition MUST be defined over
  objectively validatable timestamps only. A subjective timeliness assessment MAY gate local
  behavior (stop signing, escalate, requeue) but MUST NOT be slashable evidence by itself.

The implementation separates the two explicitly
(the corresponding block-validation operation labels
each check `objective` or `subjective`).

### 5.1 Subjective checks (local gates, never slashable)

- Arrival window: a block whose `|now − block.timestamp| > agreementTime` (by the local estimated
  clock) is treated as `NOT_ENOUGH_TIME` under normal execution — the peer declines to build the
  p2p agreement on it and the fallback path takes over. This is explicitly fallible: a slow
  network or a skewed local clock produces the same observation as a late author.

### 5.2 Objective timestamp validity (fraud-provable)

The on-chain rule
(fraud-proof verifier.\_hasInvalidTimestamp,
mirrored off-chain by building the same proof and static-calling the adjudicator):

**First block of a fork (height 0),** linked to the genesis snapshot:

```
valid  ⇔  genesis.timestamp ≤ ts ≤ genesis.timestamp + evidenceTime + p2pTime
```

**Height > 0,** linked to the previous block:

```
valid  ⇔  previousBlock.timestamp ≤ ts ≤ relevantTimestamp + p2pTime
```

where `relevantTimestamp` is:

1. `previousBlock.timestamp`, if the author had signed the previous block
   (**forfeit-of-extra-time**: a participant who attested to the predecessor cannot claim they
   saw it late); otherwise
2. the on-chain observation timestamp bound into the previous block's `postBlockCalldata`
   commitment, if one exists (the proof must supply the pre-image matching
   `keccak256(abi.encode(signedBlock, postingTime))`); otherwise
3. `previousBlock.timestamp`.

The off-chain participant-side counterpart of rule 2 is
Block.getRelevantTimestamp: if the next author signed the
block, its own timestamp governs; otherwise `max(onChainTimestamp, timestamp)`. Before accusing,
the validator attempts to recover the previous block's on-chain timestamp from chain events so it
never builds a fraud proof from incomplete timing data
(the corresponding block-validation operation).

**Boundary behavior (normative, as specified):** both bounds are inclusive — the adjudicator flags
fraud only for `ts < lower` or `ts > upper`, so a timestamp exactly at either bound is valid.

**Late on-chain posting** is objectively checkable too: a block whose calldata was posted on-chain
later than

```
previousRelevantTimestamp + firstBlockGrace + p2pTime + agreementTime + chainFallbackTime
```

is invalid (`OnChainPostTiming.TOO_LATE`), while posting exactly at the deadline is on time
(inclusive boundary; covered by a dedicated unit test).

### 5.3 Timeouts and slashing boundaries

Unavailability claims carry their own time floor: a `Timeout` names the participant, the block
height, and a `minTimeStamp` before which the claim is invalid. The off-chain participant schedules its
timeout attempts from estimated chain time and waits out `minTimeStamp` before submitting
(participant state manager); premature or otherwise invalid
claims are themselves fraud-provable (`TimeoutTooEarly`, `TimeoutCalldataPosted`, and the other
`Timeout*` dispute fraud proofs — see [fraud-proofs.md](../disputes/fraud-proofs.md), and
[disputes.md](../disputes/disputes.md) for timeout precedence in reduction).

**Open question:** the exact boundary comparisons of the `Timeout*` dispute-fraud-proof rules
(inclusive vs. exclusive at `minTimeStamp`, and how `minTimeStamp` must be derived from the timed
out block's predecessor timestamps) are not yet specified here; they must be reverse-engineered
from
DisputeFraudProofFacet
and stated normatively before the dispute documents are approved.

**Open question:** underlying-chain timestamp quality is assumed but unquantified: block
timestamps are miner/validator-controlled within consensus bounds, and the protocol windows
must dominate that manipulation margin on the target chain. The acceptable chains and their
timestamp-manipulation bounds are unspecified.

## Assumptions and constraints

The time model assumes a live chain whose timestamp rules and finality are acceptable for the deployment, an
RPC view that eventually reflects that chain, bounded clock-estimation error, and configured windows larger
than expected chain inclusion, observation, network, and processing delays. Local wall time is never objective
evidence. Timestamp comparisons must define inclusive/exclusive boundaries, overflow behavior, stale reads,
reorganizations, and the maximum supported skew.

## Security considerations

Time controls when data may be posted, disputes mature, timeouts become valid, and penalties can be applied.
Threats include dishonest/lagging RPC views, miner/validator timestamp latitude, boundary off-by-one errors,
future timestamps, stale estimates, integer overflow, delayed inclusion, and treating subjective local delay as
slashable evidence. Tests must vary authoritative and estimated time independently and prove that subjective
checks only gate local behavior while objective claims use chain-verifiable values.

## Requirements and invariants

This table is the normative requirement index. Detailed rules and rationale are defined in the sections above.

| Requirement / invariant             | Statement                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-time-1"></a>`REQ-TIME-1` | Chain time is authoritative; wall clocks are not a source of truth                                                        |
| <a id="req-time-2"></a>`REQ-TIME-2` | Honest participants keep estimated chain time within the skew bound (estimated from recent block timestamps)              |
| <a id="req-time-3"></a>`REQ-TIME-3` | Window values and skew bound are explicit configuration trade-offs; windows dominate honest skew                          |
| <a id="req-time-4"></a>`REQ-TIME-4` | Timeouts/fraud proofs/slashing use only objectively validated timestamps; subjective assessments gate local behavior only |

## Verification and test plan

Required by this specification:

- **Honest clock skew:** peers whose wall clocks disagree within the assumed bound must reach
  agreement with no false escalations; just beyond the bound, only subjective gates may fire.
  required downstream coverage.
- **Delayed observation:** a valid block delivered late must fail only subjective checks, never
  produce an `InvalidTimestamp` proof. Partially covered by the calldata-recovery unit tests;
  no dedicated delayed-delivery scenario. `gap`.
- **Adversarial timestamps:** authors stamping maximally early/late, exactly at bounds, and one
  second past bounds, off-chain and on-chain consistently. Partially covered (see above);
  boundary-exact cases exist for the posting deadline but not systematically for every rule.
  `gap`.
- **Near-threshold disagreement:** two honest peers observing an event on opposite sides of a
  window boundary must converge (through the objective rules or the dispute path) without either
  being slashed. required downstream coverage.
- **Clock estimation accuracy:** syncClock behavior under irregular block times, chain
  reorganizations, and lagging RPC endpoints. required downstream coverage.

### Requirement test matrix

Each row is a planned black-box test obligation, not an additional specification requirement. The requirement remains the authority. Execute the row through public protocol inputs from every applicable pre-state defined by this document. Every required permutation has a stable `P1`…`PN` suffix under its plan item. The list is exhaustive unless it explicitly says that boundary or pairwise representatives are sufficient; an omitted permutation needs an engineer-approved rationale.

| Plan item       | Requirements / invariants | Setup and stimulus                                                                                                                                    | Expected result                                                                                                           | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQ-TIME-1.T1` | `REQ-TIME-1`              | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Chain time is authoritative; wall clocks are not a source of truth                                                        | <a id="req-time-1.t1.p1"></a>`REQ-TIME-1.T1.P1` — valid case<br><a id="req-time-1.t1.p2"></a>`REQ-TIME-1.T1.P2` — correct identity and signature<br><a id="req-time-1.t1.p3"></a>`REQ-TIME-1.T1.P3` — before deadline<br><a id="req-time-1.t1.p4"></a>`REQ-TIME-1.T1.P4` — direct invalid/opposite case<br><a id="req-time-1.t1.p5"></a>`REQ-TIME-1.T1.P5` — wrong-identity signature<br><a id="req-time-1.t1.p6"></a>`REQ-TIME-1.T1.P6` — missing signature<br><a id="req-time-1.t1.p7"></a>`REQ-TIME-1.T1.P7` — duplicate signature<br><a id="req-time-1.t1.p8"></a>`REQ-TIME-1.T1.P8` — forged signature<br><a id="req-time-1.t1.p9"></a>`REQ-TIME-1.T1.P9` — membership-boundary signer<br><a id="req-time-1.t1.p10"></a>`REQ-TIME-1.T1.P10` — at deadline<br><a id="req-time-1.t1.p11"></a>`REQ-TIME-1.T1.P11` — after deadline<br><a id="req-time-1.t1.p12"></a>`REQ-TIME-1.T1.P12` — maximum honest skew                                                                                                                                                                                                           |
| `REQ-TIME-2.T1` | `REQ-TIME-2`              | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Honest participants keep estimated chain time within the skew bound (estimated from recent block timestamps)              | <a id="req-time-2.t1.p1"></a>`REQ-TIME-2.T1.P1` — valid case<br><a id="req-time-2.t1.p2"></a>`REQ-TIME-2.T1.P2` — correct identity and signature<br><a id="req-time-2.t1.p3"></a>`REQ-TIME-2.T1.P3` — before deadline<br><a id="req-time-2.t1.p4"></a>`REQ-TIME-2.T1.P4` — direct invalid/opposite case<br><a id="req-time-2.t1.p5"></a>`REQ-TIME-2.T1.P5` — wrong-identity signature<br><a id="req-time-2.t1.p6"></a>`REQ-TIME-2.T1.P6` — missing signature<br><a id="req-time-2.t1.p7"></a>`REQ-TIME-2.T1.P7` — duplicate signature<br><a id="req-time-2.t1.p8"></a>`REQ-TIME-2.T1.P8` — forged signature<br><a id="req-time-2.t1.p9"></a>`REQ-TIME-2.T1.P9` — membership-boundary signer<br><a id="req-time-2.t1.p10"></a>`REQ-TIME-2.T1.P10` — at deadline<br><a id="req-time-2.t1.p11"></a>`REQ-TIME-2.T1.P11` — after deadline<br><a id="req-time-2.t1.p12"></a>`REQ-TIME-2.T1.P12` — maximum honest skew                                                                                                                                                                                                           |
| `REQ-TIME-3.T1` | `REQ-TIME-3`              | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Window values and skew bound are explicit configuration trade-offs; windows dominate honest skew                          | <a id="req-time-3.t1.p1"></a>`REQ-TIME-3.T1.P1` — valid case<br><a id="req-time-3.t1.p2"></a>`REQ-TIME-3.T1.P2` — before deadline<br><a id="req-time-3.t1.p3"></a>`REQ-TIME-3.T1.P3` — zero value<br><a id="req-time-3.t1.p4"></a>`REQ-TIME-3.T1.P4` — static review of every named alternative<br><a id="req-time-3.t1.p5"></a>`REQ-TIME-3.T1.P5` — direct invalid/opposite case<br><a id="req-time-3.t1.p6"></a>`REQ-TIME-3.T1.P6` — at deadline<br><a id="req-time-3.t1.p7"></a>`REQ-TIME-3.T1.P7` — after deadline<br><a id="req-time-3.t1.p8"></a>`REQ-TIME-3.T1.P8` — maximum honest skew<br><a id="req-time-3.t1.p9"></a>`REQ-TIME-3.T1.P9` — exact balance/boundary value<br><a id="req-time-3.t1.p10"></a>`REQ-TIME-3.T1.P10` — one beyond boundary<br><a id="req-time-3.t1.p11"></a>`REQ-TIME-3.T1.P11` — maximum value<br><a id="req-time-3.t1.p12"></a>`REQ-TIME-3.T1.P12` — conservation check<br><a id="req-time-3.t1.p13"></a>`REQ-TIME-3.T1.P13` — omitted category<br><a id="req-time-3.t1.p14"></a>`REQ-TIME-3.T1.P14` — changed assumption                                                             |
| `REQ-TIME-4.T1` | `REQ-TIME-4`              | Use the applicable black-box method in the verification strategy above; exercise the behavior through public inputs without implementation internals. | Timeouts/fraud proofs/slashing use only objectively validated timestamps; subjective assessments gate local behavior only | <a id="req-time-4.t1.p1"></a>`REQ-TIME-4.T1.P1` — valid case<br><a id="req-time-4.t1.p2"></a>`REQ-TIME-4.T1.P2` — before deadline<br><a id="req-time-4.t1.p3"></a>`REQ-TIME-4.T1.P3` — new participant<br><a id="req-time-4.t1.p4"></a>`REQ-TIME-4.T1.P4` — malformed input<br><a id="req-time-4.t1.p5"></a>`REQ-TIME-4.T1.P5` — direct invalid/opposite case<br><a id="req-time-4.t1.p6"></a>`REQ-TIME-4.T1.P6` — at deadline<br><a id="req-time-4.t1.p7"></a>`REQ-TIME-4.T1.P7` — after deadline<br><a id="req-time-4.t1.p8"></a>`REQ-TIME-4.T1.P8` — maximum honest skew<br><a id="req-time-4.t1.p9"></a>`REQ-TIME-4.T1.P9` — existing participant<br><a id="req-time-4.t1.p10"></a>`REQ-TIME-4.T1.P10` — removed participant<br><a id="req-time-4.t1.p11"></a>`REQ-TIME-4.T1.P11` — slashed participant<br><a id="req-time-4.t1.p12"></a>`REQ-TIME-4.T1.P12` — concurrent membership change<br><a id="req-time-4.t1.p13"></a>`REQ-TIME-4.T1.P13` — adversarial input<br><a id="req-time-4.t1.p14"></a>`REQ-TIME-4.T1.P14` — partial failure<br><a id="req-time-4.t1.p15"></a>`REQ-TIME-4.T1.P15` — retry and recovery |

## Future Work

_Non-normative._

- Empirically choose and validate the window defaults and an explicit maximum-skew constant under
  representative delay, skew, reorg, and block-production conditions (closes the §3 open
  question).
- Periodic or block-event-driven clock re-sync, plus drift telemetry (the handshake already
  exchanges local times — InitHandshakeService
  — which could feed a cross-peer skew estimate without trusting peers).
- Resolve the sync tolerance factor (1× vs. 2× average block time) with measurements rather than
  intuition.
- Consider deriving per-chain window presets from observed block-time distributions instead of
  one global default.
