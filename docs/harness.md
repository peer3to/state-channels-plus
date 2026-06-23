# Integration Test Harness

`PeerTestHarness` (`test/fixtures/PeerTestHarness.ts`) is the SDK's end-to-end
test harness. It spins up **N real peers, the chain, and any custom precompiles
all inside one Node process**, and drives them through real signed blocks, real
on-chain events, and real state-machine transitions. It is not a mock: every
action exercises the production code paths (networking, discovery, agreement
tracking, dispute handling, the virtual clock, event hooks).

Use it to script a full scenario — a happy-path run, a failure mode (timeout,
dropout, partition), or a cheat (double-sign, junk calldata, forged dispute) —
and then assert the protocol's response on-chain.

## Mental model

Control comes in three layers:

1. **The harness object** — top-level lifecycle, peer accessors, host helpers.
2. **Action namespaces** — `harness.<namespace>.<method>()` grouped by concern
   (`transition`, `network`, `byzantine`, `dispute`, `assert`, `query`, …). The
   classes live under `test/harness/actions/`.
3. **Per-peer RPC control** — `harness.control(peer).<service>.<method>()`
   reaches inside a single peer's host runtime (read its live state, disconnect
   it, stub a behaviour, construct a dispute). The services live under
   `test/fixtures/customRpc/harnessControl/services/`.

Everything runs in-process: there is no external node and no browser. Peers
discover each other through an in-process `LocalDiscoveryServer`.

## Quick start

The harness is generic over the state machine; an app supplies app-specific
actions by extending it. The richest worked example is the **poker testbed** in
the sibling `poker-contracts` repo, whose `PokerTestHarness extends
PeerTestHarness` and adds `genesis` / `channel` / `gameplay` / `scenario`
namespaces. A complete heads-up hand:

```ts
const harness = TestSession.getHarness();

await harness.setup(2, {
    stateMachineGasLimit: 5_000_000,
    initialBalance: 1000,
    timeConfig: {
        p2pTime: 5,
        agreementTime: 10,
        chainFallbackTime: 10,
        evidenceTime: 10
    },
    customPrecompiles: [harness.createMentalPokerSdkPrecompile()]
});

const gameId = ethers.getBytes(ethers.id("my-hand"));
const { encodedGenesisState } = await harness.genesis.buildState({
    gameId,
    initialStacks: [1000, 1000]
});
await harness.channel.open(encodedGenesisState); // signs OpenChannel, posts on-chain, waits for sync

await harness.gameplay.bootstrapHand(gameId); // aggregate keys → shuffle → initial reveal
const result = await harness.gameplay.finishHand(); // betting → board reveals → showdown → settlement

expect(result.winners[0].length).to.be.greaterThan(0);
```

Run it: `pnpm hardhat test test/sdk/integration/full-hand-1v1.spec.ts` (from
`poker-contracts`). See `test/sdk/integration/*.spec.ts` for the canonical
patterns.

## The harness object

`test/fixtures/PeerTestHarness.ts`

- `setup(numPeers, options?)` — deploy contracts + precompiles, create N peers,
  open the channel. `options`: `initialBalance`, `timeConfig`,
  `customPrecompiles`, `stateMachineGasLimit`, `logLevel`, `customRpcManifest`.
- `control(peer)` — typed handle to a peer's host-side RPC services (below).
- `execOnHost(peer, fn, args)` — run a closure-free function host-side with the
  peer's live `stateManager` (escape hatch for anything the typed API misses).
- `startAutoTimeAdvance({ intervalSeconds })` — mine on a cadence so the virtual
  clock progresses without transactions.
- `quiesceHosts()` — drain detached async work; surfaces background rejections.
- `cleanup()` — dispose peers and clear barriers.

Peer accessors: `getPeer(i)`, `getPeerAddresses()`, `getHonestPeers()`,
`peerWithHighestBlock(forkId)`, plus `peers`, `channelManager`, `channelId`,
`activeForkId`, `context` (cross-block test state).

## Action namespaces

Grouped by what they control. Method lists are representative — see each class
under `test/harness/actions/` for the full, current set.

### Drive transitions & turns — `transition` (`TransitionActions.ts`)

- `submit(peer, contract => contract.fn(...), { waitForTurn, waitForSync, waitForFinalization })`
  — the core primitive: submit a state-machine transaction from a specific peer
  and choose what to block on (peer's turn, all-peers sync, full finalization).
- `submitNext`, `advanceState`, `sequenceFromHonestPeers`, `fromHonestPeersOnly`.
- Snapshots: `postSnapshot`, `postSnapshotWait`; `ingestBlockConfirmationWait`.

### Time — harness + `tamper`

- `startAutoTimeAdvance(...)` (above); `tamper.plantFreshTimeoutForNextWriter(i)`
  to force a timeout on the next writer.

### Network — `network` (`NetworkController.ts`)

- `connectAllPeers()`, `connectPeers(indices)`, `disconnectPeer(i)`,
  `waitForP2PConnections()`. Per-peer: `control(peer).network.*` (see below).

### Adversarial / Byzantine — `byzantine` (`ByzantineActions.ts`)

- `submitDoubleSignBlock(i)` — make a peer equivocate at head height.
- `postJunkCalldataOnChain(i, options)` — post invalid calldata.
- Behaviour stubs (suppress/restore): `stubBroadcast`, `stubCalldataHandler`,
  `stubPendingInboundInclusion`, `disconnect`.

### Disputes & fraud proofs — `dispute` / `tamper`

- `dispute.resolveDisputeWait()` — wait for commitment + fork reduction and
  assert the malicious peer is removed.
- `tamper.postTamperedDispute(i, tamperFn)`, `tamper.submitForgedFraudProof(...)`,
  `tamper.stubConstructDispute(...)`, `tamper.buildForgedSnapshot(...)`, plus
  static tamper helpers (`tamperAuditingDataHash`, `tamperDoubleFault`,
  `tamperInvalidStateProof`, …).

### Joining & spectators — `join` (`JoinActions.ts`)

- `addSpectatorWait()`, `addSpectator`, `joinChannelWait(params)`,
  `buildJoinChannelConfirmation(params)`.

### Handshake / RPC flows — `rpc` (`RPCActions.ts`), `rpcStub`

- `joinPeerToChannel`, `requestDisputeAcknowledgment`, `sendFakeDisputeRequest`,
  `simulateBuildOnDisputedFork`, and many handshake-timing variants; `rpcStub.*`
  for recording/teardown.

### Introspection — `query` (`StateQueryActions.ts`)

- `getLatestStateMachineStateHash(i)`, `getOnChainSnapshotHash()`,
  `getNextPeerToWrite()`, `getDisputeHashes()`, `getConnectionCount(i)`.

### Assertions — `assert` (`assert/AssertActions.ts`)

Sub-namespaces: `assert.sync.{peersInSyncWait, blockHeight, forkChangedWait}`,
`assert.calldata.{posted, noCalldataPosted}`,
`assert.dispute.{initiatedWait, committedWait}`,
`assert.snapshot.onChainSnapshotChangedWait`, `assert.storage`.

### Events — `event` (`EventActions.ts`)

- `waitForEventCounts`, `waitUntilEventOccurs`, `waitUntilPeerStatus`,
  `waitForBlockConfirmationProcessed`, `waitForPeerDisputes`, `resetEventSpies`.

### Context — `contextApi` (`ContextActions.ts`)

- `markMaliciousPeer`, `capturePrePostSnapshotContext`, `captureOriginalFork`.

## Per-peer RPC control surface

`harness.control(peer).<service>` — services in
`test/fixtures/customRpc/harnessControl/services/`:

- **query** — `getStatus`, `getForkId`, `isMyTurn`, `getNextToWrite`,
  `getLatestBlockHeight/Hash`, `getLocalStateSnapshotStruct`, `getSnapshotCount`.
- **network** — `connectToChannel`, `disconnectAllConnections`,
  `disconnectPeerByAddress`.
- **transition** — `postStateSnapshot`, `prepareUpdateSnapshotSameFork`,
  `ingestBlockConfirmation`.
- **dispute** — `constructDispute`, `getAuditingData`, `stubConstructDispute`,
  `plantFreshTimeout`, `corruptSnapshotBalanceInvariant`.
- **byzantine** — `signAndBroadcastBlock`, `submitDoubleSignBlock`,
  `postJunkCalldataOnChain`.
- **stub** — suppress/restore broadcasts, calldata posting, snapshot posting,
  pending-inbound, selective disconnect; plus call-recording (`wasX Called`).
- **spectate** — `generateSyncPayload`, `persistSyncPayload`.
- **signer** — `registerPeerSigners(secrets)` (cross-author dispute re-signing).
- **handshake** — full handshake + dispute-ack primitives.
- **balance** — `computeWithdrawalsDelta`, `subtractBalance`, `areBalancesEqual`.
- **scenario** — `exec(fnBody, args)`: run a closure-free function with the live
  `stateManager` host-side.

> These services follow the `*Service` + `*RpcMethods` convention (see AGENTS.md):
> only public endpoints on `*RpcMethods`; helpers/state on the `*Service`; values
> crossing the port are `Codec.encode`d `encoded*`.

## Extending the harness for an app

An app provides app-specific namespaces by subclassing. The poker testbed
(`poker-contracts/test/sdk/hanress/PokerTestHarness.ts`) adds:

- **genesis** — `buildState({ gameId, initialStacks, smallBlind?, bigBlind?, cardsPerPlayer? })`
  → `{ encodedGenesisState, initialPublicState }` (off-chain negotiation).
- **channel** — `open(encodedGenesisState)` → opens the channel and syncs peers.
- **gameplay** — `bootstrapHand`, `everyoneShuffles`, `everyoneInitialReveals`,
  `revealBoardCards(n)`, `finishHand()` → `{ winners, players }`,
  `resolveEvictionAfterParticipantRemoval(...)`.
- **scenario** — pre-built lines (e.g. `headsUpBlindAllInRunout`,
  `threeWayExplicitAllInCalledRunout`) + `expectAllInRunoutToShowdown`,
  `expectInvalidBettingGossipDisputed`.

Betting primitives are plain contract calls submitted through the harness, e.g.
`harness.transition.submit(peer, c => c.callBet(), { waitForTurn: true, waitForSync: true })`
— `check()`, `callBet()`, `fold()`, `raiseTo(n)`, `allIn()`.

### Two granularities

- **High-level**: `gameplay.bootstrapHand()` + `gameplay.finishHand()` play a
  whole hand for you (always check/call to showdown).
- **Low-level**: drive each transition by hand via `transition.submit(peer, c =>
c.verifyAndApplyTransition(kind, stateInput, publicState))` using a
  `MentalPokerProver` per peer — for exact betting lines, specific cards, or
  asserting intermediate state. See the third spec in `full-hand-1v1.spec.ts`.

### Poker state codes (from `contract.getBettingRound()`)

`1n` idle/new-hand · `3n` preflop bet · `4n` flop reveal · `5n` flop bet ·
`6n` turn reveal · `7n` turn bet · `8n` river reveal · `9n` river bet ·
`10n` showdown · `11n` eviction · `12n` eviction reshuffle. Read more state with
`getPokerState()`, `getCurrentActor()`, `getCurrentBet()`, `getPotSize()`,
`getPendingBoardCards()`, `getPlayer(address)`.

## Worked examples

`poker-contracts/test/sdk/integration/`:

- **`full-hand-1v1.spec.ts`** — open → bootstrap → `finishHand()` (×2 hands), plus
  a fully inline variant that drives every transition by hand.
- **`all-in-runout-guardrails.spec.ts`** — all-in lines must run straight to
  showdown without reopening betting; a malicious mid-runout bet must be disputed.
- **`timeout-eviction.spec.ts`** — 3-handed; a peer times out preflop → dispute →
  evicted (balance 0, removed) → hand continues to settlement.
- **`mid-game-spectator-join.spec.ts`** — spectator joins mid-hand, sits out, then
  plays the next hand (p2p join and on-chain `forceJoin`).
