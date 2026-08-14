# OpenChannelNegotiationService — Open-Terms Negotiation

> **Specification subject:** [specification/architecture/rpc.md](../../../../../specification/peer-communication/rpc.md)

> **Status:** Draft, reverse-engineered baseline. Pending engineer review.
> **Wiring status:** exported but **unwired** — not instantiated by `MainRpcService`.
> **Scope:** The `OpenChannelNegotiationService` service pair
> ([`OpenChannelNegotiationService.ts`](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L1),
> [`OpenChannelNegotiationRpcMethods.ts`](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts#L1),
> [`OpenChannelNegotiationHelpers.ts`](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts#L1)):
> purpose, wiring status, owned state, algorithm as implemented, and the Byzantine surface it
> would expose if wired. The shared RPC model — dispatch, guards, wire contract, outcome classes —
> is [README.md](./README.md).

## 1. Purpose & observable contract

The service negotiates the terms of a two-party `open()` and produces the doubly-signed
`OpenChannelStruct` the chain requires, entirely over peer RPC:

1. Two handshake-authenticated peers exchange their intended deposit amounts
   (`negotiateRequest` / `negotiateAccept`).
2. The participant with the numerically **lower** EVM address builds the canonical
   `OpenChannelStruct` (sorted participants, both amounts, `deadlineTimestamp = now + 60 s`,
   `isAtomic: true`, empty `data`), signs it, and sends `openProposal`.
3. The higher-address participant re-derives the expected struct from its _own_ negotiation
   state, verifies the proposal matches field-for-field and that the signature recovers to the
   lower address, co-signs, and submits `stateChannelManagerContract.open(...)` on-chain
   (gas limit 3,000,000).
4. Both sides confirm success by observing the channel become open on chain (polled at the
   deadline check), not by trusting any peer message.

What it guarantees: the local node never co-signs terms it did not negotiate
(`getOpenChannelProposalMismatch` compares channelId, participants, every balance amount and
data field, `isAtomic`, `data`, and bounds the deadline into
`(now, now + 2 × OPEN_CHANNEL_DEADLINE_SECONDS]`), and the local deposit amount placed in any
proposal is always the locally held `myAmount`, never a wire value.

What it does not guarantee: delivery (all five endpoints are fire-and-forget `sendOne`; a lost
message stalls the negotiation until a timeout resets it), progress under contention (one
negotiation slot, below), or that the counterparty funds the open — the deadline check aborts and
resets if the channel is not open on chain in time.

## 2. Wiring status

**Current:** the service is exported from the public surface
([`src/rpc/services/index.ts`](../../../../../../../src/rpc/services/index.ts#L1), together with its
RpcMethods class, the `OpenChannelNegotiationCustomRpc`/`OpenChannelNegotiationP2PManager` types,
and the helpers), but [`MainRpcService`](../../../../../../../src/rpc/MainRpcService.ts#L14) does not
instantiate it. No frame addressed to `openChannelNegotiationService` is dispatchable on a
default root — the unknown-service path disconnects the sender ([README.md](./README.md) §6.4).
It becomes reachable only when an integrator's custom root ([README.md](./README.md) §2.5) adds
it, and the root property MUST be named exactly `openChannelNegotiationService`: the service and
its RpcMethods send through `this.remoteRpc.openChannelNegotiationService`, which resolves
against that property name on the remote root (the `OpenChannelNegotiationCustomRpc` type in
[`OpenChannelNegotiationRpcMethods.ts`](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts#L1)
encodes exactly this shape).

**Intended:** undecided. [components.md](../components.md) Future Work carries the pending
choice: wire it into the default root, or document integrator wiring as the supported path.
**Open question:** whether `OpenChannelNegotiationService` is meant to join the default root is
not decidable from the code — it is fully implemented, guarded, typed for custom-root use, and
unit-tested at the helper level, but nothing in `src/` or `test/` instantiates it. (Divergence
class: decision pending.)

**Open question:** even wired, there is no supported trigger path from a worker-hosted
application. `beginNegotiation` is a _service_ method, and the `hostRpc` back-channel
([README.md](./README.md) §3) reaches only RpcMethods surfaces. An application could send
`negotiateRequest` to a peer through `hostRpc`, but the local `negotiatingWith` slot would never
be set, so the peer's `negotiateAccept` reply would be silently ignored (see §4.1). Only an
inline-host integrator holding the root instance can call `beginNegotiation`. (Divergence class:
decision pending.)

## 3. Owned state

One mutable `NegotiationState` object per service instance — i.e. **one negotiation slot per
node**, for the single channel of the owning `StateManager`:

| Field                              | Meaning                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `myAmount`                         | Local deposit amount; initialized to `DEFAULT_JOIN_AMOUNT` (500); survives resets.                                        |
| `channelOpened`                    | Latched `true` once the chain reports the channel open; survives resets; short-circuits every entry point.                |
| `negotiatingWith`                  | Checksummed counterparty address; the busy/ignore discriminator for every endpoint.                                       |
| `initiatedByMe`, `startedAtMs`     | Bookkeeping for the current round.                                                                                        |
| `theirAmount`                      | Counterparty's claimed deposit; set from the wire, unvalidated (§5.1).                                                    |
| `proposalSent`, `receivedProposal` | Proposal-phase progress markers.                                                                                          |
| `timeoutHandle`                    | The single pending timer: negotiation timeout (`NEGOTIATION_TIMEOUT_MS` = 20 s) or, after a proposal, the deadline check. |

`resetNegotiation(reason)` clears everything except `myAmount` and `channelOpened` and cancels
the timer. Timers use raw `setTimeout`, not the `TimeoutManager`, and no dispose hook cancels
them; a timer that fires after `StateManager` disposal performs best-effort chain reads inside a
swallowing `catch`.

## 4. Methods and algorithm as implemented

All five remote endpoints return `void`/`Promise<void>` — fire-and-forget under the delivery
model of [README.md](./README.md) §2.4 (broadcastable; no reply, no delivery report). The
service declares `HandshakeCompletedGuard`, so every endpoint runs only for
handshake-authenticated peers; each handler additionally derives the counterparty from
`senderTransport.peerAddress` (the handshake-verified address), never from parameters, and
returns silently when it is absent.

### 4.1 Remote endpoints (`OpenChannelNegotiationRpcMethods`)

- **`negotiateRequest(channelId, amount)`** — wrong `channelId` (string comparison against the
  local channel's hexlified id) → silent ignore. Busy with another peer → send `negotiateBusy`
  back. Free slot → claim it (`negotiatingWith = from`, `initiatedByMe = false`, start the 20 s
  timeout). Then store `theirAmount = amount` (last write wins — a repeated request from the
  current counterparty updates the amount), reply `negotiateAccept(channelId, myAmount)`, and run
  `maybeProgress`.
- **`negotiateAccept(channelId, amount)`** — wrong channelId, no negotiation, or sender ≠
  current counterparty → silent ignore. Else store `theirAmount = amount` and run
  `maybeProgress`.
- **`negotiateBusy()`** — if sent by the current counterparty, reset the negotiation; otherwise
  silent ignore.
- **`openProposal(encodedOpenChannel, lowerSignature)`** — sender ≠ current counterparty →
  silent ignore. No negotiation in progress → claim the slot and start the timeout, then delegate
  to the service (§4.2); because the wrapper claims the slot first, the service's own
  "no negotiation in progress" blacklist branch is unreachable from the wire.
- **`abort(reason)`** — if sent by the current counterparty, reset (the attacker-controlled
  `reason` string is only logged); otherwise silent ignore.

### 4.2 Service-side flow (`OpenChannelNegotiationService`)

- **`beginNegotiation(peerAddress)`** (local, integrator-called): no-ops if the channel is
  already open, the peer is self, or a negotiation is in flight; else claims the slot, starts the
  timeout, and sends `negotiateRequest(channelId, myAmount)`.
- **`maybeProgress(peer)`**: checks the chain (local diamond, then a refresh) — if the channel is
  already open, latch `channelOpened` and reset. Only the **lower-address** participant
  proceeds: once `theirAmount` is a number and no proposal was sent, it builds the
  `OpenChannelStruct` (participants sorted by numeric address; balances aligned to the sort;
  deadline `now + 60 s`), signs it (`SignatureUtils.signOpenChannel`), sends `openProposal`, sets
  `proposalSent`, and schedules the deadline check.
- **`openProposal(peer, encodedOpenChannel, lowerSignature)`** (receiver side, higher address
  only): disconnect + blacklist the sender when the local node _is_ the lower address, when no
  amount was ever negotiated (`theirAmount` not a number — blocks cold, unsolicited proposals
  from being validated against default balances), when the signature does not recover to the
  lower participant, or when `getOpenChannelProposalMismatch` reports any field deviation from
  the locally reconstructed terms. On success: co-sign, submit `open(...)` with both signatures
  (3 M gas limit), tolerate the `RaceConditionChannelAlreadyOpen` custom error (peer's open won
  the race; defer to the `ChannelOpened` event), on other tx failure send `abort` and reset, and
  schedule the deadline check.
- **`scheduleDeadlineCheck(deadline, peer)`**: replaces the negotiation timer; sleeps until
  `deadline + agreementTime` (or `agreementTime` if the deadline already passed), then checks the
  chain — open → latch `channelOpened` and reset; past-deadline and not open → send
  `abort("deadline passed and channel not opened")` and reset. All errors in the timer body are
  swallowed (best-effort).

## 5. Byzantine assessment — the surface this service would expose if wired

Everything below is conditional on an integrator wiring the service into a root; today none of it
is reachable ([README.md](./README.md) §2.2). The caller population is
handshake-authenticated peers (the guard), which is weaker than it sounds: any peer that
completes the challenge/response handshake qualifies, participant or not.

### 5.1 Malformed payloads

`params` arrive spread raw ([README.md](./README.md) §4); no endpoint validates types:

- **`amount` is unvalidated.** A non-number stalls (`typeof` checks in `maybeProgress` /
  `openProposal` never see `haveAmounts`), which is a silent semantic dead-end, not an error.
  `NaN`, `Infinity`, negatives, and fractions **pass** the `typeof === "number"` checks and reach
  `BigInt(...)` in the mismatch comparison or ABI encoding in `signOpenChannel`, both of which
  throw; the throw escapes the fire-and-forget handler and the dispatcher disconnects the sender
  (no blacklist — [README.md](./README.md) §6.4). Observed fact: this violates [`REQ-RPC-2-SZDTTM`](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm)'s
  decode-and-validate-before-effect rule; the failure is contained to a disconnect, but it is an
  escaping exception, not a handled protocol failure. (Divergence class: bug against [`REQ-RPC-2-SZDTTM`](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm) —
  latent while unwired.)
- **`encodedOpenChannel` / `lowerSignature`** are decoded inside the handler without a guard
  around `Codec.decode` / signature recovery; undecodable bytes likewise throw → disconnect.
  Non-string types in `channelId`/`reason` are harmless (failed comparison → silent ignore; log
  text).

### 5.2 Flooding

No rate limiting exists at the boundary ([`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk), [README.md](./README.md) §9), so:

- **Slot occupation.** One `negotiateRequest` claims the single negotiation slot for up to 20 s;
  honest peers get `negotiateBusy` for the duration, and the attacker can re-claim immediately
  after every reset. A single authenticated peer can keep a node permanently unable to negotiate
  with anyone else, penalty-free.
- **Reply amplification is 1:1** (`negotiateRequest` → `negotiateAccept` or `negotiateBusy`);
  no multiplication, but each request from the current counterparty re-sends `negotiateAccept`
  and re-runs `maybeProgress`, which performs up to two chain reads (`isChannelOpen`, plus a
  refresh) — a cheap-to-send, chain-read-per-frame load vector.
- **`openProposal` is the expensive endpoint:** per frame, an ECDSA recovery, potentially a local
  signature and an on-chain `open` transaction (§5.4).

### 5.3 Semantic abuse

- **Attacker-chosen terms are bounded to their own side.** The counterparty controls only
  `theirAmount` (its own deposit) and, as proposer, the deadline within
  `(now, now + 120 s]`. The local deposit is always the local `myAmount`; participants and
  channelId are locally reconstructed; `isAtomic`/`data` are pinned. The co-signing check
  (`getOpenChannelProposalMismatch`) is the load-bearing defense — a valid lower signature proves
  only that the peer signed _those_ bytes, and the receiver refuses to authorize anything it did
  not negotiate.
- **Last-write-wins amount updates.** The current counterparty can re-send `negotiateRequest` to
  change `theirAmount` up to the moment the proposal is built; both sides evaluate the proposal
  against their own latest state, so a mid-flight change desynchronizes the two views and the
  mismatch check rejects the proposal (disconnect + blacklist of an honest-but-raced peer is
  possible; the initiator is not penalized on the busy/timeout path).
- **Counterparty-only resets.** `abort`/`negotiateBusy` are honored only from the current
  counterparty, so third parties cannot tear down someone else's negotiation; the counterparty
  aborting is legitimate behavior, indistinguishable from griefing by design.

### 5.4 Replay

The RPC layer has no replay protection ([README.md](./README.md) §6.7), and these endpoints are
neither idempotent nor replay-rejecting in the [`REQ-RPC-6-E60S4J`](../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) sense:

- Replaying a captured **valid `openProposal`** while the negotiation state still matches re-runs
  the whole acceptance path — another co-signature and another on-chain `open` submission with a
  3 M gas limit. Duplicates revert (`RaceConditionChannelAlreadyOpen` is tolerated), but each
  costs the victim a reverted transaction: a **gas-griefing vector** until `channelOpened`
  latches. After a reset, a replay is stopped by the `theirAmount`-not-negotiated branch
  (disconnect + blacklist).
- `negotiateRequest`/`negotiateAccept` replays are absorbed by state (amount overwrite,
  re-sent accept) — harmless apart from the §5.2 load.

**Open question:** the [`REQ-RPC-6-E60S4J`](../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) classification for `openProposal` (make it replay-rejecting via
a per-round nonce/marker, or idempotent by latching after the first accepted proposal) is
undecided; so is whether the slot-occupation DoS (§5.2) warrants a penalty or per-peer cooldown,
versus deferring entirely to the central rate limiter ([`OQ-6-4JPNE5`](../../../../../specification/open-questions.md#oq-6-4jpne5)). (Divergence class: decision
pending.)

### 5.5 Silent-ignore outcome class

Most invalid or out-of-sequence input — wrong channelId, wrong sender, no negotiation in
progress, missing peer address — returns early with no consequence: no disconnect, no blacklist,
no error, at most a log line. This is already recorded in the shared model
([README.md](./README.md) §7, §8) and feeds the register's failure-outcome-policy decision
([`OQ-34-FY08V2`](../../../../../specification/open-questions.md#oq-34-fy08v2), [../../open-questions.md](../../../../../specification/open-questions.md)): silent ignore makes out-of-sequence
probing penalty-free, in contrast to the disconnect+blacklist consequences on the proposal path.

## 6. Assumptions, constraints & dependencies

- Exactly **two** participants; the lower/higher address split assigns the proposer role
  deterministically. The single `NegotiationState` assumes one channel per `StateManager`.
- Depends on: `HandshakeCompletedGuard` (caller authentication), `ProfileManager` blacklisting,
  `SignatureUtils`/`Codec` (struct signing and decoding),
  `stateChannelManagerContract.open` and the local diamond's `isChannelOpen` (chain truth),
  `Clock`/`timeConfig.agreementTime` (deadline check), and a provider on the signer for the
  deadline's block-timestamp read.
- Constants ([`OpenChannelNegotiationHelpers.ts`](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts#L1)):
  `DEFAULT_JOIN_AMOUNT` 500, `NEGOTIATION_TIMEOUT_MS` 20 000, `OPEN_CHANNEL_DEADLINE_SECONDS`
  60; the receiver accepts deadlines up to 2× the proposer's offset to tolerate clock skew.
- Fire-and-forget delivery: a dropped message stalls until the 20 s timeout or deadline check
  resets the round; there is no retry.

## 7. Invariants & failure behavior

| ID                                              | Invariant                                                                                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="inv-ocn-1-dzvpey"></a>`INV-OCN-1-DZVPEY` | At most one negotiation is in flight per node; frames from any peer other than the current counterparty never mutate the active round (they are refused busy or silently ignored).                 |
| <a id="inv-ocn-2-9xjj27"></a>`INV-OCN-2-9XJJ27` | The local deposit amount in any proposal the node signs or co-signs is the locally held `myAmount`; no wire value can change the local side of the balances.                                       |
| <a id="inv-ocn-3-278dcq"></a>`INV-OCN-3-278DCQ` | The node co-signs an `OpenChannelStruct` only when it matches the locally reconstructed negotiated terms field-for-field and the accompanying signature recovers to the lower-address participant. |
| <a id="inv-ocn-4-kxh0re"></a>`INV-OCN-4-KXH0RE` | Once `channelOpened` latches, every endpoint and timer path is a no-op for this channel.                                                                                                           |

Failure behavior: proposal-path violations (proposal to the lower side, unnegotiated proposal,
bad signature, term mismatch) → disconnect + blacklist by EVM address + reset. Handler throws
(malformed `amount`, undecodable proposal bytes) → dispatcher disconnect, no blacklist.
Everything else → silent ignore or timeout-driven reset (§5.5). Open-tx failure → `abort` to the
peer + reset; open race → tolerated.

## 8. Verification

Concrete test evidence is owned by the downstream verification layer. This section defines implementation-specific obligations only.

### Implementation test plan

These are concrete component-level tests required by the implementation obligations in this document. Exercise public boundaries with real domain values and collaborators. Every listed permutation is required unless an engineer records why it is not applicable.

| Plan item                                             | Requirement / invariant                                            | Setup and stimulus                                                                                                      | Expected result                                                                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-ocn-1-rxjnth.t1"></a>`REQ-OCN-1-RXJNTH.T1` | <a id="req-ocn-1-rxjnth"></a>`REQ-OCN-1-RXJNTH`                    | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Every endpoint binds the counterparty to the handshake-verified transport address; parameters never select the peer.                            | <a id="req-ocn-1-rxjnth.t1.p1"></a>`REQ-OCN-1-RXJNTH.T1.P1` — valid case<br><a id="req-ocn-1-rxjnth.t1.p2"></a>`REQ-OCN-1-RXJNTH.T1.P2` — correct identity/signature<br><a id="req-ocn-1-rxjnth.t1.p3"></a>`REQ-OCN-1-RXJNTH.T1.P3` — direct invalid/opposite<br><a id="req-ocn-1-rxjnth.t1.p4"></a>`REQ-OCN-1-RXJNTH.T1.P4` — wrong identity/signature<br><a id="req-ocn-1-rxjnth.t1.p5"></a>`REQ-OCN-1-RXJNTH.T1.P5` — missing identity/signature<br><a id="req-ocn-1-rxjnth.t1.p6"></a>`REQ-OCN-1-RXJNTH.T1.P6` — duplicate identity/signature<br><a id="req-ocn-1-rxjnth.t1.p7"></a>`REQ-OCN-1-RXJNTH.T1.P7` — forged identity/signature<br><a id="req-ocn-1-rxjnth.t1.p8"></a>`REQ-OCN-1-RXJNTH.T1.P8` — membership boundary                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| <a id="req-ocn-2-wvtf4n.t1"></a>`REQ-OCN-2-WVTF4N.T1` | <a id="req-ocn-2-wvtf4n"></a>`REQ-OCN-2-WVTF4N`                    | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | The receiver co-signs only the exact negotiated terms; any field deviation or bad lower signature → disconnect + blacklist + reset.             | <a id="req-ocn-2-wvtf4n.t1.p1"></a>`REQ-OCN-2-WVTF4N.T1.P1` — valid case<br><a id="req-ocn-2-wvtf4n.t1.p2"></a>`REQ-OCN-2-WVTF4N.T1.P2` — correct identity/signature<br><a id="req-ocn-2-wvtf4n.t1.p3"></a>`REQ-OCN-2-WVTF4N.T1.P3` — direct invalid/opposite<br><a id="req-ocn-2-wvtf4n.t1.p4"></a>`REQ-OCN-2-WVTF4N.T1.P4` — wrong identity/signature<br><a id="req-ocn-2-wvtf4n.t1.p5"></a>`REQ-OCN-2-WVTF4N.T1.P5` — missing identity/signature<br><a id="req-ocn-2-wvtf4n.t1.p6"></a>`REQ-OCN-2-WVTF4N.T1.P6` — duplicate identity/signature<br><a id="req-ocn-2-wvtf4n.t1.p7"></a>`REQ-OCN-2-WVTF4N.T1.P7` — forged identity/signature<br><a id="req-ocn-2-wvtf4n.t1.p8"></a>`REQ-OCN-2-WVTF4N.T1.P8` — membership boundary                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| <a id="req-ocn-3-rgp58t.t1"></a>`REQ-OCN-3-RGP58T.T1` | <a id="req-ocn-3-rgp58t"></a>`REQ-OCN-3-RGP58T`                    | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Open success is confirmed against the chain, never against a peer message; the deadline check aborts and resets a round the chain did not open. | <a id="req-ocn-3-rgp58t.t1.p1"></a>`REQ-OCN-3-RGP58T.T1.P1` — valid case<br><a id="req-ocn-3-rgp58t.t1.p2"></a>`REQ-OCN-3-RGP58T.T1.P2` — correct identity/signature<br><a id="req-ocn-3-rgp58t.t1.p3"></a>`REQ-OCN-3-RGP58T.T1.P3` — before deadline<br><a id="req-ocn-3-rgp58t.t1.p4"></a>`REQ-OCN-3-RGP58T.T1.P4` — direct invalid/opposite<br><a id="req-ocn-3-rgp58t.t1.p5"></a>`REQ-OCN-3-RGP58T.T1.P5` — wrong identity/signature<br><a id="req-ocn-3-rgp58t.t1.p6"></a>`REQ-OCN-3-RGP58T.T1.P6` — missing identity/signature<br><a id="req-ocn-3-rgp58t.t1.p7"></a>`REQ-OCN-3-RGP58T.T1.P7` — duplicate identity/signature<br><a id="req-ocn-3-rgp58t.t1.p8"></a>`REQ-OCN-3-RGP58T.T1.P8` — forged identity/signature<br><a id="req-ocn-3-rgp58t.t1.p9"></a>`REQ-OCN-3-RGP58T.T1.P9` — membership boundary<br><a id="req-ocn-3-rgp58t.t1.p10"></a>`REQ-OCN-3-RGP58T.T1.P10` — at deadline<br><a id="req-ocn-3-rgp58t.t1.p11"></a>`REQ-OCN-3-RGP58T.T1.P11` — after deadline<br><a id="req-ocn-3-rgp58t.t1.p12"></a>`REQ-OCN-3-RGP58T.T1.P12` — maximum honest skew                                                                                            |
| <a id="inv-ocn-1-dzvpey.t1"></a>`INV-OCN-1-DZVPEY.T1` | [`INV-OCN-1-DZVPEY`](open-channel-negotiation.md#inv-ocn-1-dzvpey) | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | One negotiation slot; non-counterparty frames never mutate the active round.                                                                    | <a id="inv-ocn-1-dzvpey.t1.p1"></a>`INV-OCN-1-DZVPEY.T1.P1` — valid case<br><a id="inv-ocn-1-dzvpey.t1.p2"></a>`INV-OCN-1-DZVPEY.T1.P2` — zero/empty/no-op where meaningful<br><a id="inv-ocn-1-dzvpey.t1.p3"></a>`INV-OCN-1-DZVPEY.T1.P3` — direct invalid/opposite<br><a id="inv-ocn-1-dzvpey.t1.p4"></a>`INV-OCN-1-DZVPEY.T1.P4` — exact boundary<br><a id="inv-ocn-1-dzvpey.t1.p5"></a>`INV-OCN-1-DZVPEY.T1.P5` — failure/recovery<br><a id="inv-ocn-1-dzvpey.t1.p6"></a>`INV-OCN-1-DZVPEY.T1.P6` — relevant race                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| <a id="inv-ocn-2-9xjj27.t1"></a>`INV-OCN-2-9XJJ27.T1` | [`INV-OCN-2-9XJJ27`](open-channel-negotiation.md#inv-ocn-2-9xjj27) | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | The local balance side of any signed proposal is the locally held `myAmount`.                                                                   | <a id="inv-ocn-2-9xjj27.t1.p1"></a>`INV-OCN-2-9XJJ27.T1.P1` — valid case<br><a id="inv-ocn-2-9xjj27.t1.p2"></a>`INV-OCN-2-9XJJ27.T1.P2` — correct identity/signature<br><a id="inv-ocn-2-9xjj27.t1.p3"></a>`INV-OCN-2-9XJJ27.T1.P3` — zero value<br><a id="inv-ocn-2-9xjj27.t1.p4"></a>`INV-OCN-2-9XJJ27.T1.P4` — direct invalid/opposite<br><a id="inv-ocn-2-9xjj27.t1.p5"></a>`INV-OCN-2-9XJJ27.T1.P5` — wrong identity/signature<br><a id="inv-ocn-2-9xjj27.t1.p6"></a>`INV-OCN-2-9XJJ27.T1.P6` — missing identity/signature<br><a id="inv-ocn-2-9xjj27.t1.p7"></a>`INV-OCN-2-9XJJ27.T1.P7` — duplicate identity/signature<br><a id="inv-ocn-2-9xjj27.t1.p8"></a>`INV-OCN-2-9XJJ27.T1.P8` — forged identity/signature<br><a id="inv-ocn-2-9xjj27.t1.p9"></a>`INV-OCN-2-9XJJ27.T1.P9` — membership boundary<br><a id="inv-ocn-2-9xjj27.t1.p10"></a>`INV-OCN-2-9XJJ27.T1.P10` — exact balance/boundary<br><a id="inv-ocn-2-9xjj27.t1.p11"></a>`INV-OCN-2-9XJJ27.T1.P11` — one beyond boundary<br><a id="inv-ocn-2-9xjj27.t1.p12"></a>`INV-OCN-2-9XJJ27.T1.P12` — maximum value<br><a id="inv-ocn-2-9xjj27.t1.p13"></a>`INV-OCN-2-9XJJ27.T1.P13` — conservation check |
| <a id="inv-ocn-3-278dcq.t1"></a>`INV-OCN-3-278DCQ.T1` | [`INV-OCN-3-278DCQ`](open-channel-negotiation.md#inv-ocn-3-278dcq) | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | Co-signing requires field-exact term match plus lower-address signature recovery.                                                               | <a id="inv-ocn-3-278dcq.t1.p1"></a>`INV-OCN-3-278DCQ.T1.P1` — valid case<br><a id="inv-ocn-3-278dcq.t1.p2"></a>`INV-OCN-3-278DCQ.T1.P2` — correct identity/signature<br><a id="inv-ocn-3-278dcq.t1.p3"></a>`INV-OCN-3-278DCQ.T1.P3` — direct invalid/opposite<br><a id="inv-ocn-3-278dcq.t1.p4"></a>`INV-OCN-3-278DCQ.T1.P4` — wrong identity/signature<br><a id="inv-ocn-3-278dcq.t1.p5"></a>`INV-OCN-3-278DCQ.T1.P5` — missing identity/signature<br><a id="inv-ocn-3-278dcq.t1.p6"></a>`INV-OCN-3-278DCQ.T1.P6` — duplicate identity/signature<br><a id="inv-ocn-3-278dcq.t1.p7"></a>`INV-OCN-3-278DCQ.T1.P7` — forged identity/signature<br><a id="inv-ocn-3-278dcq.t1.p8"></a>`INV-OCN-3-278DCQ.T1.P8` — membership boundary                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| <a id="inv-ocn-4-kxh0re.t1"></a>`INV-OCN-4-KXH0RE.T1` | [`INV-OCN-4-KXH0RE`](open-channel-negotiation.md#inv-ocn-4-kxh0re) | Exercise the real public component or contract boundary, including rejection and failure paths without partial effects. | `channelOpened` latches and disables all endpoints and timers for the channel.                                                                  | <a id="inv-ocn-4-kxh0re.t1.p1"></a>`INV-OCN-4-KXH0RE.T1.P1` — valid case<br><a id="inv-ocn-4-kxh0re.t1.p2"></a>`INV-OCN-4-KXH0RE.T1.P2` — before deadline<br><a id="inv-ocn-4-kxh0re.t1.p3"></a>`INV-OCN-4-KXH0RE.T1.P3` — direct invalid/opposite<br><a id="inv-ocn-4-kxh0re.t1.p4"></a>`INV-OCN-4-KXH0RE.T1.P4` — at deadline<br><a id="inv-ocn-4-kxh0re.t1.p5"></a>`INV-OCN-4-KXH0RE.T1.P5` — after deadline<br><a id="inv-ocn-4-kxh0re.t1.p6"></a>`INV-OCN-4-KXH0RE.T1.P6` — maximum honest skew                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Future Work

_Non-normative._

- Decide the wiring question (§2) and, if wired by default, add the service to the README
  service table as a wired entry and to [components.md](../components.md).
- Validate `amount` (finite nonnegative integer within a configured bound) at the endpoint
  (§5.1) and route `Codec.decode`/recovery failures through handled rejection instead of
  escaping throws.
- Replay/idempotence decision for `openProposal` (§5.4) and slot-occupation mitigation (§5.2),
  coordinated with the central rate limiter ([`OQ-6-4JPNE5`](../../../../../specification/open-questions.md#oq-6-4jpne5)).
- An API for configuring `myAmount` (today it is a mutable public field defaulting to 500).
- Move timers to the `TimeoutManager` and cancel them on disposal (§3).
- A supported application-side trigger for `beginNegotiation` under worker hosting (§2).

## Implementation traceability

| Requirement / invariant                                            | Statement                                                                                                                                       | Implementation status | Implementation evidence                                                                                                                                                                                                                                                                                                             | Gap / divergence |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-OCN-1-RXJNTH`](open-channel-negotiation.md#req-ocn-1-rxjnth) | Every endpoint binds the counterparty to the handshake-verified transport address; parameters never select the peer.                            | Covered               | [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts#L3)                                                                                                                                                  | None.            |
| [`REQ-OCN-2-WVTF4N`](open-channel-negotiation.md#req-ocn-2-wvtf4n) | The receiver co-signs only the exact negotiated terms; any field deviation or bad lower signature → disconnect + blacklist + reset.             | Covered               | [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L5) (`openProposal`), [OpenChannelNegotiationHelpers.ts](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts#L1) | None.            |
| [`REQ-OCN-3-RGP58T`](open-channel-negotiation.md#req-ocn-3-rgp58t) | Open success is confirmed against the chain, never against a peer message; the deadline check aborts and resets a round the chain did not open. | Covered               | [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L5) (`maybeProgress`, `scheduleDeadlineCheck`)                                                                                                             | None.            |
| [`INV-OCN-1-DZVPEY`](open-channel-negotiation.md#inv-ocn-1-dzvpey) | One negotiation slot; non-counterparty frames never mutate the active round.                                                                    | Covered               | [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts#L3)                                                                                                                                                  | None.            |
| [`INV-OCN-2-9XJJ27`](open-channel-negotiation.md#inv-ocn-2-9xjj27) | The local balance side of any signed proposal is the locally held `myAmount`.                                                                   | Covered               | [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L5) (`getParticipantsAndBalances`)                                                                                                                         | None.            |
| [`INV-OCN-3-278DCQ`](open-channel-negotiation.md#inv-ocn-3-278dcq) | Co-signing requires field-exact term match plus lower-address signature recovery.                                                               | Covered               | [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L5), [OpenChannelNegotiationHelpers.ts](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts#L1)                  | None.            |
| [`INV-OCN-4-KXH0RE`](open-channel-negotiation.md#inv-ocn-4-kxh0re) | `channelOpened` latches and disables all endpoints and timers for the channel.                                                                  | Covered               | [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts](../../../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L5)                                                                                                                                                        | None.            |
