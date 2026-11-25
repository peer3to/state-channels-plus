# Verification Assessment

> **Agent assessment:** Current as of 2026-08-29, after the proxy-routing, ABI-boundary, handshake-promotion,
> and transport-lifecycle coverage repairs.
> **Engineer disposition:** Pending.

Existing tests are not treated as evidence by filename. Each declaration remains a visible queue item until
an engineer-reviewed report assigns it the test IDs it covers in full. Current scores live in
[generated/verification-coverage.md](../generated/verification-coverage.md); this document explains **why the
scores are what they are** and which lever moves each one.

The simplification coverage uses real pre-deployment ports, authenticated host probes, factory-built blocks, actual provider loading and real logger stores. The full distributed gate passed all 1,987 runnable cases; Node and browser typechecks and both real browser gates passed. The review follow-up passed all 1,987 cases again in run-1653 after the separate import-order cleanup; the focused dependency/storage/manager run passed 125 cases. Existing skipped cases and unassigned specification permutations remain gaps, not evidence. New declarations have exact component permutations; moved declarations retain their existing claims only where the actual oracle still matches.

## Watched keys — 2026-11-25

Eleven declarations in [LightClientWatchedKeys.test.ts](../verification/tests/test/lightClient/LightClientWatchedKeys.test.ts.md)
cover [`REQ-LC-12-VPAAP0.T1`](../specification/runtime/light-client.md#req-lc-12-vpaap0.t1) `P1`-`P10` and `P13`, and
[`REQ-LC-5-MM0BM9.T1.P19`](../specification/runtime/light-client.md#req-lc-5-mm0bm9.t1.p19), against a peer3 node built from
PR #3 at `6bf84b6` behind the recording proxy. Eleven faults each failed a declaration: no watch, the
method list ignored (twice), the first message not waited for, no watch again on a new subscription,
the watch again sent before the first message, the answer's block not checked, its taken keys not
checked, the asked keys kept instead of the taken ones, the contract dropped at the last unfollow, and
the reader ignoring the watch. Three of them first survived: the refusal declarations answered with an
empty proof, which fails anyway, and the new subscription's first message reached the participant
before the watch could; the declarations now answer with the node's own proof and hold the first
message, and catch them. Gaps: `P11` and `P12` (more than 1,024 keys) and
[`REQ-LC-8-BBYC51.T1.P5`](../specification/runtime/light-client.md#req-lc-8-bbyc51.t1.p5), the start-up follow, which
needs a participant on a peer3 node as `T1.P1`-`P4` do; the local channel flows show it. The light client
suites passed 116 of 116 locally (run-193) and the canonical distributed gate 4324 of 4324. Local
channel flows (peer3 node, Mac, three repeats): the steady state asks 0.52 requests per rotation round
against 2.19 before the watch and 6.00 without the light client; with the reads compared, 413 matched and
none differed.

## Startup chain requests: chain id once per connection, one latest-block read per clock sync — 2026-11-23

The node and multi-node providers take the network a node's socket detected instead of asking for
the chain id again, and the startup clock log uses the block the clock synchronization read. Two
declarations in [RpcNodes.test.ts](../verification/tests/test/evm/RpcNodes.test.ts.md) count
`eth_chainId` at the proxies
([`UNIT-TEST-RPC-NODE-1-VTXH1M.P14`](../implementation/source/src/evm/p2pRuntime/rpcNodes/RpcNodeProvider.ts.md#unit-test-rpc-node-1-vtxh1m),
[`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P34`](../implementation/source/src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts.md#unit-test-multi-rpc-1-svggz5));
one in [Clock.test.ts](../verification/tests/test/Clock.test.ts.md) checks the kept block
([`UNIT-TEST-CLOCK-AVERAGE-1-6PDVR0.P6`](../implementation/source/src/Clock.ts.md#unit-test-clock-average-1-6pdvr0));
one in [E2E-MultiRpcNodes.test.ts](../verification/tests/test/e2e/E2E-MultiRpcNodes.test.ts.md)
counts a proxied peer's startup requests
([`UNIT-TEST-P2P-RUNTIME-HOST-36-Z741VG`](../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md#unit-test-p2p-runtime-host-36-z741vg)
P1, P2). Six faults (each provider's override removed, the node's network not kept while it is
down, the startup log reading the block again, the sync keeping another block) each failed a
declaration. On the distributed runner RpcNodes passed 58 of 58, Clock 12 of 12, E2E-MultiRpcNodes
28 of 28, StateManagerAbort 12 of 12 and DisputeManager 111 of 112; the one is "a capped kill whose
preflight at its limit passes…", which fails the same way on `dev` under Hardhat. The light client
suites passed 105 of 105 locally (run-141). The replay requirement stays read by the dispute manager
on its first replaying send, as [`UNIT-TEST-DISPUTE-MANAGER-6-YRBGQ9`](../implementation/source/src/disputeManager/DisputeManager.ts.md#unit-test-dispute-manager-6-yrbgq9) P10-P13 specify (engineer's
decision, 2026-11-23).

## Light client reads share proofs and best-block lookups — 2026-11-23

Reads at one block now ask the endpoint once for each value, and reads made at once while nothing is
pushed ask once for the best block. Four declarations cover the shared proofs
([`REQ-LC-9-KWXV43.T1.P13`](../specification/runtime/light-client.md#req-lc-9-kwxv43.t1.p13)-`P15` in
[LightClientFollowedChannel.test.ts](../verification/tests/test/lightClient/LightClientFollowedChannel.test.ts.md), and
[`REQ-LC-9-KWXV43.T2.P1`](../specification/runtime/light-client.md#req-lc-9-kwxv43.t2.p1) in
[LightClientProvider.test.ts](../verification/tests/test/lightClient/LightClientProvider.test.ts.md)); the
proxy holds the first read's proof request and counts what the endpoint is asked. Four faults (no
sharing, block values not shared, slots of one account not told apart, a failed proof kept) each failed
its declaration. Two declarations cover the shared best-block lookup
([`REQ-LC-1-JT5PKT.T1.P27`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1.p27),
[`P28`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1.p28)): the proxy holds the
lookup's request, or its answer while the block floor rises. Three faults (no sharing, the floor
ignored, a lookup kept after its answer) each failed a declaration; the last failed `T2.P1`, which
needs a second lookup after the first was answered. The light client suites passed 105 of 105
locally against the local build of peer3-parachain PR #3 (`--lc-tests`, run-129). Not run yet: the
distributed gate and the farm flows for these changes.

## Storage proof verifier tests — 2026-11-18

[SubstrateTrieProof.test.ts](../verification/tests/test/unit/SubstrateTrieProof.test.ts.md) (20 declarations) and
[FrontierStorageProofVerifier.test.ts](../verification/tests/test/unit/FrontierStorageProofVerifier.test.ts.md)
(10 declarations) cover all 15 planned cases of [`REQ-STPROOF-1-J20P5Y` (A slot value is accepted only when the proof decides it)](../specification/runtime/storage-proofs.md#req-stproof-1-j20p5y) and [`REQ-STPROOF-2-ABCQR7` (One verifier per proof representation)](../specification/runtime/storage-proofs.md#req-stproof-2-abcqr7) and the 30
cases of [`UNIT-TEST-STPROOF-1-K1CTJZ`](../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateTrieProof.ts.md#unit-test-stproof-1-k1ctjz) and [`UNIT-TEST-STPROOF-2-QT42T0`](../implementation/source/src/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierStorageProofVerifier.ts.md#unit-test-stproof-2-qt42t0). The positive oracles are recorded
chain data: read proofs of four slots of one contract on Moonbeam at block 16796696, that block's state
root, and the chain's own `eth_getStorageAt` answers; and read proofs of three slots of a test contract on
a peer3 dev node at two blocks, with that node's own answers. Traversal paths and malformed nodes the real
proofs do not reach use hand-encoded one-node tries. Each of 15 single-line faults put into the two source
files (a missing node read as empty, each refusal switched off, each traversal rule broken) failed at least
one of the first 28 declarations, and all 28 passed with the source restored; the two peer3 declarations
were added afterwards. Not covered: the browser build beyond its typecheck.

[SubstrateHeader.test.ts](../verification/tests/test/unit/SubstrateHeader.test.ts.md) (10 declarations) and
`proveFrontierStorageBlock.test.ts` (removed on 2026-11-20) (11
declarations) cover all 15 planned cases of [`REQ-STPROOF-3-NVJGR0` (A pushed partition is accepted only as its proof decides it under its own header)](../specification/runtime/storage-proofs.md#req-stproof-3-nvjgr0). Their data is three blocks a peer3 dev
node pushed through the sidecar on 2026-11-18, with the block hashes that node reported. Each of 11
single-line faults put into the three source files failed at least one declaration, and all 51 light client
declarations passed with the source restored. The recorded blocks were the sidecar's only evidence until the live suite below.

`LightClientPushedBlocks.test.ts` (removed on 2026-11-20) (3
declarations, added 2026-11-18) is the first suite that starts a peer3 node: each declaration runs the
binary `PEER3_NODE_BIN` names with the sidecar in front of it, and the runner discovers the file only with
`--lc-tests`. Its declarations cover the three live cases of [`REQ-STPROOF-3-NVJGR0.T2`](../specification/runtime/storage-proofs.md#req-stproof-3-nvjgr0.t2) with the node's own
receipt, block hash and storage read as oracles. `test/lightClient/LightClientEndpoints.test.ts` (4
declarations) is marked out of specification scope: two declarations check the endpoint behaviour the
sidecar stands in for, a block without a subscribed topic and a removed subscription, which no requirement
states yet; two check the failure "RPC node doesn't support LC endpoints" (Luka, 2026-11-18), without a node
binary and against a node that does not list the methods. Each of six single-line faults (topic filter off,
unsubscribe kept, endpoint check off, missing-binary check off, discovery filter off, flag ignored) failed
its declaration, and all passed with the code restored. Not covered: a distributed worker, because no
worker protocol provides the node binary and the orchestrator skips these tasks with a warning; a node that
leaves a write out of a pushed block; the node's own endpoint, which does not exist yet.

[FrontierAccountProofVerifier.test.ts](../verification/tests/test/unit/FrontierAccountProofVerifier.test.ts.md)
(18 declarations, added 2026-11-19) covers all 18 planned cases of [`REQ-STPROOF-4-XK5S64` (An account's nonce, balance and code are accepted only when the proof decides…)](../specification/runtime/storage-proofs.md#req-stproof-4-xk5s64). Its positive oracles are
proofs recorded from a peer3 dev node (`zero-fee-node` at d845dbfb, run locally that day) for five addresses
at one block, with that node's own `eth_getTransactionCount`, `eth_getBalance` and `eth_getCode` answers.
Balances with a frozen or reserved part were not recorded from the node, which holds none on the dev chain:
those cases use hand-encoded account entries, so the rule for them rests on the cited runtime source, not on
a chain answer. Each of 10 single-line faults put into the account verifier and the key derivations (each
part of the balance rule, the field order, each refusal, each absent-entry answer, each key prefix) failed
at least one declaration, and all passed with the source restored.

[LightClientProvenReads.test.ts](../verification/tests/test/lightClient/LightClientProvenReads.test.ts.md) (6
declarations, added 2026-11-19) covers the six planned cases of [`REQ-STPROOF-5-HRDXEG.T1`](../specification/runtime/storage-proofs.md#req-stproof-5-hrdxeg.t1) on a peer3 node of each
declaration's own, discovered only with `--lc-tests`. The oracles are the node's own block hash, Ethereum
block and Ethereum reads at the same block. The refusals put the existing `RpcNodeProxy` in front of the
node and make it answer one request in the node's place, with the node's real proof of an earlier block or
with no proof or header. Each of eight single-line faults put into the reader (the block hash left out of
the proof request, each shape check off, the empty-read shortcut off, a wrong key for the account, the code
or a slot, the state root taken from another field) failed its declaration, and all passed with the source
restored. Not covered: a distributed worker, as for the suite above, so CI does not run this suite yet; a
node that gives the header of another chain; a read at the genesis block, whose header names no Ethereum
block.

[LightClientProvider.test.ts](../verification/tests/test/lightClient/LightClientProvider.test.ts.md) (15
declarations, added 2026-11-19) covers the 15 planned cases of [`REQ-LC-1-JT5PKT.T1`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1), [`REQ-LC-2-PMY1VG.T1`](../specification/runtime/light-client.md#req-lc-2-pmy1vg.t1), [`REQ-LC-3-W7RRHM.T1`](../specification/runtime/light-client.md#req-lc-3-w7rrhm.t1)
and [`REQ-LC-4-E29Y46.T1`](../specification/runtime/light-client.md#req-lc-4-e29y46.t1) and the live case of [`REQ-STPROOF-6-CASBQP.T2`](../specification/runtime/storage-proofs.md#req-stproof-6-casbqp.t2), each on a peer3 node of its own behind
`--lc-tests`. The provider is the SDK's own, built by `createRpcNodesProvider`; the oracles are the node's
answers to the same reads, the provider's counters, the requests a proxy saw and the logged errors.
[FrontierEthereumHeader.test.ts](../verification/tests/test/unit/FrontierEthereumHeader.test.ts.md) (8
declarations) covers [`REQ-STPROOF-6-CASBQP.T1`](../specification/runtime/storage-proofs.md#req-stproof-6-casbqp.t1) on a block entry recorded from a peer3 dev node, with that node's
Ethereum block hash as the oracle for every header field. Each of 22 single-line faults put into the provider, the light client, its state,
the parser, the reader's block values, the chain's constants and the factory failed its declaration, and
all passed with the source restored. Not covered: the same suite in CI, because no
distributed worker has the node binary; more than one endpoint; a read while the provider's endpoint is
down; the pass limit; the full SDK suite with the light client on, which is the farm rollout.

Reworked on 2026-11-20 with the partitions a peer3 node pushes. Every suite runs on a peer3 node of its
own started with `--light-client` (peer3-parachain PR #3), behind `--lc-tests`; the sidecar and its
recorded pushes are gone.
[FrontierPushedPartition.test.ts](../verification/tests/test/unit/FrontierPushedPartition.test.ts.md) (10
declarations) covers the new [`REQ-STPROOF-3-NVJGR0.T1`](../specification/runtime/storage-proofs.md#req-stproof-3-nvjgr0.t1) cases on five messages recorded from such a node, with
the node's own answers at each block as the oracle; it needs no node and runs in CI.
[LightClientPushedPartitions.test.ts](../verification/tests/test/lightClient/LightClientPushedPartitions.test.ts.md) (6 declarations) covers [`REQ-STPROOF-3-NVJGR0.T2`](../specification/runtime/storage-proofs.md#req-stproof-3-nvjgr0.t2) live.
[LightClientFollowedChannel.test.ts](../verification/tests/test/lightClient/LightClientFollowedChannel.test.ts.md) (12 declarations) covers [`REQ-LC-5-MM0BM9.T1`](../specification/runtime/light-client.md#req-lc-5-mm0bm9.t1),
[`REQ-LC-7-W8WDN3.T1`](../specification/runtime/light-client.md#req-lc-7-w8wdn3.t1), [`REQ-LC-9-KWXV43.T1`](../specification/runtime/light-client.md#req-lc-9-kwxv43.t1) and [`REQ-LC-10-YCP80W.T1`](../specification/runtime/light-client.md#req-lc-10-ycp80w.t1); a read of the followed partition is checked to ask
the endpoint nothing. [LightClientLocalRuns.test.ts](../verification/tests/test/lightClient/LightClientLocalRuns.test.ts.md) (7 declarations) and seven new
declarations of [LightClientProvider.test.ts](../verification/tests/test/lightClient/LightClientProvider.test.ts.md) cover the new cases of [`REQ-LC-1-JT5PKT.T1`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1)
to [`REQ-LC-4-E29Y46.T1`](../specification/runtime/light-client.md#req-lc-4-e29y46.t1), with the node's own answer to the same call as the oracle. The light client suites passed
85 of 85 locally, and the whole Mocha suite on the distributed runner, where every runtime now uses the
light client provider over Hardhat, passed 3553 of 3554; the one failure passed alone. Faults: of 11
single-line faults put in together, one each into the partition's pruning and header check, the
resubscription, the created-code checkpoints, the precompile filter, the value rule, the endpoint
question's retry, the closed-provider rule, Hardhat's error code, the subscription retry and the stage
record, each failed its own declaration; a fault that skips the partitions in a read failed every
pushed-state declaration; a fault that drops early pushes failed six declarations. Two faults failed
none: using a lost connection's pushes, and ignoring the endpoint's end of a subscription. Not covered:
those two, the endpoint ending a lagging subscription
([`REQ-LC-7-W8WDN3.T1.P4`](../specification/runtime/light-client.md#req-lc-7-w8wdn3.t1.p4), a gap), [`REQ-LC-8-BBYC51.T1`](../specification/runtime/light-client.md#req-lc-8-bbyc51.t1), which needs a runtime on a peer3 node with the
channel contract deployed, and the full SDK suite on peer3 nodes with the light client on; the
`--lc-tests` suites in CI, because no distributed worker has the node binary.

Follow-up on 2026-11-20 and 2026-11-21: the two faults that failed none are now caught.
[`REQ-LC-7-W8WDN3.T1.P4`](../specification/runtime/light-client.md#req-lc-7-w8wdn3.t1.p4) has its declaration (the endpoint ends a subscription), which also checks the warning that names the
endpoint's reason, and [`REQ-LC-5-MM0BM9.T1.P16`](../specification/runtime/light-client.md#req-lc-5-mm0bm9.t1.p16) checks that nothing a lost connection pushed is used. A review of the merged
stack on 2026-11-21 found that the stack merge refused every push with more than one proof node (the
lower PR's `isHexString(value, length)` met this PR's one-argument check); with the check aligned,
`FrontierPushedPartition.test.ts` passed 11 of 11 on the merged tree, where it had failed 10 of 11. The
fixes of that review each have a declaration, and each declaration failed with its fix removed: a
refused or ended subscription opened again after one block time
([`REQ-LC-7-W8WDN3.T1.P5`](../specification/runtime/light-client.md#req-lc-7-w8wdn3.t1.p5)), an endpoint without the light client endpoints among two ([`REQ-LC-4-E29Y46.T1.P7`](../specification/runtime/light-client.md#req-lc-4-e29y46.t1.p7)), a call
reading the blob base fee ([`REQ-LC-2-PMY1VG.T1.P7`](../specification/runtime/light-client.md#req-lc-2-pmy1vg.t1.p7)), the block floor after a receipt and with the pushes stopped
([`REQ-LC-1-JT5PKT.T1.P17`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1.p17), [`P18`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1.p18)), an earlier pushed block refused ([`REQ-STPROOF-3-NVJGR0.T1.P28`](../specification/runtime/storage-proofs.md#req-stproof-3-nvjgr0.t1.p28)), and the replay at
the receipt's block in the default tier ([`UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P45`](../implementation/source/src/utils/evmErrorHandler.ts.md#unit-test-evm-error-handler-1-dp1mjf), `P46`; renumbered from P42 and P43 when dev was merged in, whose own P42 to P44 came first). The light client
suites passed 68 of 68 locally against the node built from peer3-parachain PR #3 with that day's fixes.
The bot review that followed added three declarations, and each failed with its fix removed: new heads
a million blocks ahead from the endpoint that does not serve the requests keep no read off the pushed
state ([`REQ-LC-1-JT5PKT.T1.P19`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1.p19), failed with the floor taken from every endpoint), pushes held past a
read's wait are waited for again once they arrive ([`P20`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1.p20), failed with the stall kept after an
accepted push), and another block of the held height is taken
([`REQ-STPROOF-3-NVJGR0.T1.P31`](../specification/runtime/storage-proofs.md#req-stproof-3-nvjgr0.t1.p31), failed with a same-height block refused). The light client suites then
passed 70 of 70.

S4 on 2026-11-21, on the engineer's four decisions of that day and the choice that the replicated
mirror reads go to the chain as well. With the reads compared
([`REQ-LC-11-MTCBF9` (With the reads compared, each answer is checked against the endpoint's at its…)](../specification/runtime/light-client.md#req-lc-11-mtcbf9)), each local answer is asked of the endpoint by Ethereum block hash, which the peer3
node answers; six reads, a revert among them, matched, a call the proxy answered otherwise was
counted and logged, and a failed one was counted as not compared. The declarations failed with the
block named by its Substrate hash and with every answer taken as alike. With the chain's reads proven,
the local-first reads, the mirror's state-proof tier and the eight plain mirror read sites (window
time three times, commitment twice, slashed participants once, the proof anchor once, the spectator's
snapshot once) go to the chain alone ([`REQ-MIRROR-5-N5SZC9` (With proven chain reads, the chain answers alone)](../specification/enforcement/local-mirror.md#req-mirror-5-n5szc9)). After the bot's first review round the evidence is:
`preferLocal`'s unit suite with 11 declarations ([`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P13`](../implementation/source/src/utils/localDiamond.ts.md#unit-test-prefer-local-1-xc95t6)-`P15` for
proven reads); [`REQ-LC-11-MTCBF9.T1.P6`](../specification/runtime/light-client.md#req-lc-11-mtcbf9.t1.p6)-`P13` for failover, a lost connection, the proving block's
hash after the chain moved, and each kind of differing answer; and
[`REQ-MIRROR-5-N5SZC9.T4`](../specification/enforcement/local-mirror.md#req-mirror-5-n5szc9.t4), run on the test chain with a harness stub that makes a runtime's chain
reads count as proven (`stubProvenChainReads`): the timeout check's reads
([`UNIT-TEST-PARTICIPANT-TIMEOUT-SERVICE-1-Q0PAF5.P41`](../implementation/source/src/stateManager/chainFallback/ParticipantTimeoutService.ts.md#unit-test-participant-timeout-service-1-q0paf5)-`P45`), construction and verification
([`UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P67`](../implementation/source/src/agreementManager/AgreementManager.ts.md#unit-test-agreement-manager-1-kj6q9d), `P68`), the pending-set check and the countersigner's
exception ([`REQ-JOINSIG-1-8X1A4V.T1.P34`](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v.t1.p34)). Each of these failed with its fix removed. On 17a2c37e4
the whole Mocha suite passed 3615 of 3615 on the distributed runner and the light client suites 83
of 83 against the node built from peer3-parachain PR #3. A first full run found a circular import (`@/utils` re-exports the local diamond module,
which had imported the chain provider) that failed `InternalTransport.test.ts` 11 of 11; the helpers
moved to `provenChainReads.ts` and the file passed 11 of 11. Not run: participants on a peer3 node
with the light client on and the reads compared
([`REQ-MIRROR-5-N5SZC9.T3.P1`](../specification/enforcement/local-mirror.md#req-mirror-5-n5szc9.t3.p1), a gap), because the test harness runs participants on Hardhat nodes only; running them on a peer3 node with
the channel contracts deployed is planned with the farm workers step. The engineer's two exceptions
stay local while proven, the join countersigner's membership check and the ingest gate's disputed
flag, and neither goes to the chain while proven. Revised 2026-11-22, when the engineer removed both
exceptions: the countersigner declaration now shows the threshold read on the chain and none on the
mirror ([`REQ-MIRROR-5-N5SZC9.T4.P5`](../specification/enforcement/local-mirror.md#req-mirror-5-n5szc9.t4.p5)), and a new unit declaration shows the ingest gate asking the
chain ([`REQ-MIRROR-5-N5SZC9.T4.P18`](../specification/enforcement/local-mirror.md#req-mirror-5-n5szc9.t4.p18)), and two unit declarations show a failed gate read
putting queued blocks back ([`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P62`](../implementation/source/src/stateManager/ingest/BlockQueueManager.ts.md#unit-test-block-queue-manager-1-yws2d2) and [`UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P63`](../implementation/source/src/stateManager/ingest/BlockQueueManager.ts.md#unit-test-block-queue-manager-1-yws2d2)); each failed with its source change
reverted.

A second review of the merged stack on 2026-11-21 led to fixes in the light client and in each mirror
read site. Each new declaration failed with its fix removed: a log the serving endpoint delivered raises
its block floor
([`REQ-LC-1-JT5PKT.T1.P21`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1.p21)), a read whose endpoint names a best block below the floor is left to the endpoint
and counted as failed ([`P22`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1.p22)), the stall is kept per endpoint
([`P23`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1.p23)), an endpoint is asked again after its connection reopens
([`REQ-LC-4-E29Y46.T1.P8`](../specification/runtime/light-client.md#req-lc-4-e29y46.t1.p8)), a refused subscription is counted once and opened again when the endpoint fails to
end it ([`REQ-LC-7-W8WDN3.T1.P6`](../specification/runtime/light-client.md#req-lc-7-w8wdn3.t1.p6), [`P7`](../specification/runtime/light-client.md#req-lc-7-w8wdn3.t1.p7)), a value the endpoint proved for an earlier read is
counted by what the read used ([`REQ-LC-9-KWXV43.T1.P7`](../specification/runtime/light-client.md#req-lc-9-kwxv43.t1.p7)), and a compared call at a block the
endpoint no longer has is not compared ([`REQ-LC-11-MTCBF9.T1.P14`](../specification/runtime/light-client.md#req-lc-11-mtcbf9.t1.p14)); nine declarations, nine
faults, all caught. Every mirror read site now has a declaration with the chain's reads proven
([`REQ-MIRROR-5-N5SZC9.T4.P10`](../specification/enforcement/local-mirror.md#req-mirror-5-n5szc9.t4.p10)-`P17`, and
[`P8`](../specification/enforcement/local-mirror.md#req-mirror-5-n5szc9.t4.p8) for the spectate requester): the slash handler, the acknowledgment responder,
dispute construction (the omission answer and the slashed participants), the spectate responder's
snapshot, the audit's local-first predicate and window time, and the force-join deadline. Thirteen
faults switched a site back to the mirror, or skipped the chain's anchor and tier at construction and
verification; each failed its declaration. The node of peer3-parachain PR #3 at 42e5e80 passed 56 of
56 Rust tests, and six faults in its partition and worker code were all caught. On e16c6a628 the
whole Mocha suite passed 3627 of 3627 on the distributed runner, and the light client suites 91 of 91
against the node built from 42e5e80.
The bot review that followed added three declarations, each failing with its change removed: a
log-search answer and a block answered by number raise the floor
([`REQ-LC-1-JT5PKT.T1.P24`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1.p24), [`P25`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1.p25)), and a pending block raises none
([`P26`](../specification/runtime/light-client.md#req-lc-1-jt5pkt.t1.p26)); with them the light client fixes count twelve declarations and twelve faults, all
caught. The peer3 node numbers its pending block at its best block, so P26 has the endpoint number it
one above, as geth and Hardhat do. On 8a9a0178f the light client suites passed 94 of 94 against the
node built from 42e5e80.

## Gas estimates at the pending block, genesis-free block time, parachain test runs — 2026-11-20

Engineer decisions (Luke, 2026-11-20, PR #605):

- The runtime's provider estimates gas at the `pending` block, the one a transaction lands in. ethers
  sends no block, and geth and Frontier then estimate at the latest block's timestamp, so a timeout
  claim sent at its `minTimeStamp` failed its first estimate. Frontier runs even a `pending` estimate
  on the head's state and timestamp, so the peer3 node answers a `pending` estimate of a call on a
  pending block of its own, stamped with the next block's slot time (peer3-parachain #1).
  [RpcNodes.test.ts](../verification/tests/test/evm/RpcNodes.test.ts.md) checks that a call valid
  only after the latest block's second estimates
  ([`UNIT-TEST-MULTI-RPC-1-SVGGZ5`](../implementation/source/src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts.md#unit-test-multi-rpc-1-svggz5) `.P29`).
  A revert at the pending block is confirmed at the latest block before it stands, and the pending
  block's revert is the one reported: a pending block can hold other senders' unmined transactions
  (geth's does), and a competitor's pending reduce that never lands must not end ours (`.P30`, `.P31`;
  each fails without its rule).
- The clock leaves genesis out of the measured block time: a fresh parachain's genesis has timestamp 0
  ([`UNIT-TEST-CLOCK-AVERAGE-1-6PDVR0`](../implementation/source/src/Clock.ts.md#unit-test-clock-average-1-6pdvr0)).
- `--parachain` runs the slot nodes, the isolated test nodes and the tests on the parachain dev node,
  locally or on the workers, whose runner image copies the node image peer3-parachain publishes
  (`docker/zero-fee-node.Dockerfile` there). In E2E-Timeouts, "should handle timeout when next peer to write does not
  author a block", "should demonstrate timeout creates disputes", "should handle timeout when non-author
  peer disconnects (calldata posting)" and "should handle timeout when author peer disconnects", with
  all of RpcNodes.test.ts, passed on the farm with `--parachain` on the pinned node, peer3-parachain
  `4e60b71` (run-1198, 57 passing).

## WebAssembly diagnostics and browser worker failure tests — 2026-10-29

PR #579 review cards TO4, TO5, TY2 and TY3.
[ThreadResources.test.ts](../verification/tests/test/utils/ThreadResources.test.ts.md) gains two declarations:
`instantiateStreaming` from a `Response` counts one instance and one memory
([`UNIT-TEST-THREAD-RESOURCES-1-AY7843`](../implementation/source/src/utils/threadResources.ts.md#unit-test-thread-resources-1-ay7843) `.P5`), and a fresh `worker_threads` worker whose
`WebAssembly.Memory` refuses to grow before the SDK loads reports `canGrow16MiB: false` with the error, with
one probe shared by two traps (`.P6`).
[RuntimeLifecycle.test.ts](../verification/tests/test/rpc/RuntimeLifecycle.test.ts.md) gains one declaration: a child
failure with a pending request logs `resources`, and `wasm` only for a trap restored from the wire
([`UNIT-TEST-REMOTE-ROOT-1-7D9JVE`](../implementation/source/src/rpc/internal/RemoteRoot.ts.md#unit-test-remote-root-1-7d9jve) `.P6`).
The [browser worker gate](../verification/tests/test/browser/run-worker-contract-executor.mjs.md) gains four
declarations in real Chromium: an `ErrorEvent` with no message, a second bare `error` event during the
diagnostic fetch, the disposal of a ready worker the owner saw fail, and a worker whose startup throws a real
trap and uploads its error line, with `wasm`, before its creation rejects. The load-failure case now also checks
that no `error` event reached the page's window. Each new browser oracle, and the window check, failed with the
code temporarily broken (no `resolveClosing` in `onerror`, no fetch guard, no `preventDefault`, `startupFailed`
posted before the upload settled) and passed with it restored. They cover
[`REQ-RUNTIME-8-M3ENFM.T1.P6`](../specification/runtime/execution.md#req-runtime-8-m3enfm.t1.p6), [`REQ-RUNTIME-8-M3ENFM.T1.P7`](../specification/runtime/execution.md#req-runtime-8-m3enfm.t1.p7),
[`REQ-RUNTIME-8-M3ENFM.T1.P8`](../specification/runtime/execution.md#req-runtime-8-m3enfm.t1.p8), [`REQ-RUNTIME-7-A2VAR0.T1.P15`](../specification/runtime/execution.md#req-runtime-7-a2var0.t1.p15) and
[`REQ-LOG-10-69CTN1.T1.P6`](../specification/runtime/log-collection.md#req-log-10-69ctn1.t1.p6), with `.P5`, `.P10` and `.P11` of
[`UNIT-TEST-BROWSER-ROOT-WORKER-1-1WG3WR`](../implementation/source/src/rpc/internal/browser/RootWorkerRuntime.ts.md#unit-test-browser-root-worker-1-1wg3wr) and `.P42` of
[`UNIT-TEST-ROOT-CREATION-1-1NWN3V`](../implementation/source/src/rpc/internal/createRoot.ts.md#unit-test-root-creation-1-1nwn3v).

## WebAssembly failure diagnostics — 2026-10-26

New report [ThreadResources.test.ts](../verification/tests/test/utils/ThreadResources.test.ts.md) with four
declarations. They use two hand-built modules (an exported memory, and a `trap` that runs
`unreachable`) in the Node test thread: entry-point counting with `instanceof` intact, a real trap
serialized with its diagnostics and kept through `deserializeError` and a second serialization, no
diagnostics on an ordinary error, and one worker count across repeated shutdowns. They cover `.P1`
to `.P4` of [`UNIT-TEST-THREAD-RESOURCES-1-AY7843`](../implementation/source/src/utils/threadResources.ts.md#unit-test-thread-resources-1-ay7843) and `.P7` of
[`UNIT-TEST-ERROR-WIRE-1-ZWGJ00`](../implementation/source/src/rpc/internal/errorWire.ts.md#unit-test-error-wire-1-zwgj00). The refused probe, the new log fields and the
startup-failure upload have tests since 2026-10-29 (above).

## Application chain access, local join-signature answers, closed-transport frames — 2026-10-26

[RpcNodes.test.ts](../verification/tests/test/evm/RpcNodes.test.ts.md) gains four log-subscription declarations on
two proxied nodes of one private chain: each log once with no `eth_newFilter`, failover after the first node
drops, destroy right after a subscription, and unsubscribe at every node.
[JoinChannelSignatureRequest.test.ts](../verification/tests/test/rpc/joinChannel/JoinChannelSignatureRequest.test.ts.md)
gains the held-chain-RPC collection and the mirror-miss fallback; the deadline case is renamed to "…on the
responder's local clock" and now runs on the shared chain: it reads the responder's `Clock` second and calls the
real `signJoinRequest` in one synchronous run (staging in `JoinSignatureDeadlineStaging`).
[NetworkRpcRouter.test.ts](../verification/tests/test/rpc/NetworkRpcRouter.test.ts.md) deletes "keeps network
receive-after-close admission unchanged" and adds "drops network frames on a closed transport before dispatch or
logging". The harness `ValidationProbeService.postBlockCalldataOnChain` now only broadcasts and returns the
transaction hash; `TransitionActions.postBlockCalldataOnChainWait` waits for the receipt on the harness provider,
and every caller moved to it with unchanged oracles. The participant-lifecycle lone-leaver case and the first
`U71` unit case now wait for `NOT_OPENED` with `waitUntilPeerStatus`: the leave check reports `onLeftChannel`
before the close handler sets `NOT_OPENED`, and the specification does not order them.
[RpcNodes.test.ts](../verification/tests/test/evm/RpcNodes.test.ts.md) adds three declarations:
"subscribes a reconnected node socket again and relays its logs once"
([`REQ-CHAINOBS-4-JA3YF8.T1.P5`](../specification/runtime/chain-observation.md#req-chainobs-4-ja3yf8.t1.p5)) cuts and restores the first node, then cuts the second, so
only the reopened socket can deliver the next log; "does not relay a log 128 or more blocks below the highest
relayed log" ([`REQ-CHAINOBS-4-JA3YF8.T1.P6`](../specification/runtime/chain-observation.md#req-chainobs-4-ja3yf8.t1.p6)) withholds two log notifications at the proxy, mines with
`hardhat_mine` to 128 blocks above the first, and releases them: the log 127 below is delivered and the log 128
below is not; "rejects the exported chain access startup when no node is reachable and destroys every node"
([`REQ-CHAINOBS-4-JA3YF8.T1.P7`](../specification/runtime/chain-observation.md#req-chainobs-4-ja3yf8.t1.p7)) calls `createRpcNodesProvider` from the SDK index and checks the
credential-safe error and that no destroyed node reconnects. Each failed with the code temporarily broken (no
subscription on a reopened socket, no bound check, no node destroy) and passed with it restored. The once case
now checks every log once, not only the first.

## Initial-sync deadline hold, two-window sync default, browser worker failure cause and drain — 2026-10-26

[P2PManager.test.ts](../verification/tests/test/P2PManager.test.ts.md) gains six declarations. Five hold the
observer's real participant reads past the initial deadline and end them as participant, "not a participant",
a rejection, one of two at a time, or after the transports closed; one checks that the initial sync request
times out after two windows. The genesis-settle case now checks that the settle cancels the deadline task and
that a task still run afterwards changes nothing. The E2E-BotConnectionFixes H11 timeout case asserts the
two-window default for a non-initial caller. The case "initial handshake selects the two-window channel-load
sync entry" is renamed to "initial handshake starts one channel-load sync and reaches SYNCED"; it still claims no
permutation. The case "observer ignores a stale false sync result once chain genesis already synced it" now
waits for the recorded settle of the timed-out request (result `false`) instead of a fixed sleep. The
[browser worker gate](../verification/tests/test/browser/run-worker-contract-executor.mjs.md) gains six
declarations in real Chromium: load, fetch, parse and top-level failures; the failure-log write that throws;
the drain that stores a just-written error line before disposal returns; the not-ready disposal without the
wait; and the drain timeout with and without a throwing warning write.
The permutations left untested here have tests since 2026-10-29 (above).

## Worker drain bound and refused handle close — 2026-10-14

[RootWorkerDrain](../verification/tests/test/rpc/RootWorkerDrain.test.ts.md) gains three cases on a real
parentless executor worker: a diagnostics report that throws (exit still happens, no diagnostics are posted, the
warning is still logged without them; review FY1), an exit with code 86 the owner did not request (stays a failure, no warning; review TO1), and a bound
native udx socket with the parent in a child process (no abort, exit 86, warning names `udp`; review FO1).
[RuntimeLifecycle](../verification/tests/test/rpc/RuntimeLifecycle.test.ts.md) gains two worker-SDK cases through
the real client and runtime-host worker path: a UDP socket already closing when the worker closes its handles,
ahead of an open one (the root-cause reproduction: on `c4948a5` the `closeRootWorker` throw leaves the open socket
holding the loop and `P2pInstance.dispose()` never resolves; with the fix the worker exits 0 with no warning), and
a leaked referenced timer (review TY1). The three earlier drain cases keep their oracles. Two cases for the
removed per-step teardown bounds (a final close that never settles, a domain disposal that never settles) were
deleted with that code, and their permutations `.P5` and `.P6` retired. The new cases are pending the lead's gate.

## Exit post in flight across the channel close — 2026-10-14

Two E2E cases in the
[participant-lifecycle report](../verification/tests/test/e2e/E2E-ParticipantLifecycle.test.ts.md) stage the
race where the other leavers' exits close the channel while a third leaver's exit post is already prepared
against the open fork. The stub action `holdSnapshotPostSend` parks that post at its contract send (before its
gas estimate) or, with the new `at: "broadcast"` option, in the signer after its estimate passed; it is released
only after the chain snapshot is deleted. They cover
[`REQ-LIF-10-QR8NQ9.T1.P27`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p27) (rejected at the
estimate) and [`REQ-LIF-10-QR8NQ9.T1.P28`](../specification/settlement/lifecycle.md#req-lif-10-qr8nq9.t1.p28)
(mined revert, custom error read back by the replay in `SnapshotUpdateService`). No production code changes.
Both passed in the canonical gate run-3197 on 2026-10-14 (`yarn test:parallel:distributed --test-parallel-script
--test-browser`, 3770/3770), which ran the content committed as `c4948a5`.

## Join and top-up retry after a snapshot move — 2026-10-10

The [join snapshot guard report](../verification/tests/test/e2e/E2E-JoinSnapshotGuard.test.ts.md) holds the
joiner's join or top-up submissions at their send, has the participants finalize and post a newer snapshot,
and releases one held submission at a time through the stub action `releaseOneMembershipSubmission`; the
submission hold reads its gate per call so it also holds the retry. E42 is rewritten: on the public route one
move to a stored snapshot ends with the join returning `true`, the joiner pending and no abort, and a static
replay of the stale confirmation still reverts with the snapshot-mismatch error; it covers
[`REQ-TJOIN-5-Q795M7.T1.P21`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7.t1.p21)
and [`REQ-MSG-10-7JS45Q.T2.P3`](../specification/settlement/cross-layer-messages.md#req-msg-10-7js45q.t2.p3).
The connect declarations cover
[`REQ-TJOIN-5-Q795M7.T1.P15`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7.t1.p15)
to [`REQ-TJOIN-5-Q795M7.T1.P17`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7.t1.p17)
and [`REQ-JOINSIG-1-8X1A4V.T1.P5`](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v.t1.p5).
A joiner made blind to block confirmations by `stubDropNetworkConfirmations` sees a chain-only move, aborts
and is not admitted
([`REQ-TJOIN-5-Q795M7.T1.P18`](../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7.t1.p18));
the abort comes from the join submission path: the snapshot-mismatch refusal is not retried because the joiner
does not store the new snapshot, and the final refusal aborts the runtime.
A participant's top-up through `connectToChannel` with a balance is submitted twice and returns `true`
([`REQ-JOINSIG-1-8X1A4V.T1.P6`](../specification/peer-communication/join-authorization.md#req-joinsig-1-8x1a4v.t1.p6)).
The retry tests wait for two held submissions; they do not prove that no third one follows.
`returns false for a stale top-up guard without aborting participation` in
[E2E-JoinChannelRaceConditions](../verification/tests/test/e2e/E2E-JoinChannelRaceConditions.test.ts.md)
submits a top-up with a made-up snapshot pin. No runtime stores that pin, so the retry condition, which needs
both the pinned and the new snapshot stored, is not met, and the test still returns `false` (passed in the
full gate).

## Test timing inputs — 2026-11-21

Engineer decision (Luke, 2026-11-21, PR #606), standing: a parachain test whose `evidenceTime` is
below the harness minimum `MIN_TEST_TIME_CONFIG.evidenceTime` (10) may be raised to 10 once its log
shows `RaceConditionDisputeEvidencePeriodExpired` refusing in-window work; each raise still gets an
entry here. The rule is mirrored in `test/AGENTS.md` ("Protocol wait budgets"). First use: the three U72 cases in
`BotConnectionFixes.test.ts` whose leaver submits its self-removal for an observed dispute go from
the staging's 4 to 10. On the parachain, observing the dispute, building the self-removal and
landing it spans two or three 2 s blocks, so 4 s let the chain refuse it with
`RaceConditionDisputeEvidencePeriodExpired`. No oracle changed.

## Test timing inputs — 2026-11-20

Engineer decision (Luke, 2026-11-20, PR #606): `disputerThrottle.test.ts` widens its active-window
`evidenceTime` from 5 to 10 for the two "within evidenceTime" cases. On the parachain the second
dispute's estimate is judged at the block it lands in, a 2 s slot after the build, so construction under
farm load plus one or two blocks can outlast 5 s and the throttle has run out; 10 s leaves room. No
oracle changed.

## Test timing inputs — 2026-10-15

Engineer decision (Luka, 2026-10-15, PR #551): raise the test evidence windows by a few seconds;
implemented as the harness defaults `MIN_TEST_TIME_CONFIG.evidenceTime` 6 → 10 and
`INBOUND_GAP_TIME_CONFIG.evidenceTime` 4 → 8 in `test/harness/core/testTimeConfig.ts`, so an honest auditor's kill
under farm load lands inside the kill period ([`FIND-DISPUTE-5-MZPTTC`](open-findings.md#find-dispute-5-mzpttc)). The
values stay magic numbers like every timing input; the production value is still undecided.

Decision (daiagi, 2026-10-15, PR #551): per-test overrides keep their values; each is sized for its own staged timing,
and several are deliberately short so the window expires (for example `runKillSentAfterKillPeriod`). This is a
protocol input, not a wait budget; no oracle changed.

Engineer decision (Luka, 2026-10-15): the shared invalid-dispute staging's kill period
`DEFAULT_INVALID_DISPUTE_EVIDENCE_TIME` (`preDisputeSetup` in `test/harness/actions/math/MathScenarioActions.ts`)
goes 8 → 12, the harness default plus two seconds. Its purpose is headroom over the default; after the default became
10 it sat two seconds below it. In the full gate an honest auditor's audit, own-dispute build and kill estimate took
about 7–8 s on the farm and the kill was refused with `RaceConditionDisputeKillPeriodExpired` (no starvation; peak
event-loop delay 381 ms). This is a protocol input, not a wait budget; the kill barriers scale with it.

## Test timing inputs — 2026-10-14

Engineer decision (Luka, 2026-10-14): `evidenceTime` 8 → 12 in `stageSpamAfterOwnDispute`
([DisputeWindowWorkflowStaging](../../../test/fixtures/DisputeWindowWorkflowStaging.ts)), the staging of both E22
cases in [E2E-KillAndDispute](../verification/tests/test/e2e/E2E-KillAndDispute.test.ts.md). The staged spam
`uploadDispute` must land inside peer 0's evidence window after three peers' full commit handling of peer 0's own
dispute, one estimate and send, and one 1 s interval-mining block. Under load it was mined 1 s after the 8 s
evidence window. Approved by Luka 2026-10-14. This is a protocol input, not a wait budget; no oracle changed.
Both E22 cases passed with 12 s in the canonical gate run-3197 on 2026-10-14 (3770/3770).

## Test timing inputs — 2026-10-12

Engineer decision (Luka, 2026-10-12): `evidenceTime` 4 → 6 in `assertHonestPeersContributeAfterSelfRemoval`
([HonestLeaverDisputeStaging](../../../test/fixtures/HonestLeaverDisputeStaging.ts)), the selfRemoval
contribution case. The staging's other tests keep 4 s. The remaining founders audit the leaver's self-removal
dispute and then contribute their newer state into its window. Under full-gate load that path took about 5 s:
the audit took about 2 s, and the contributions were sent 3 s after the window opened and mined after the 4 s
evidence period, so all three were refused with `RaceConditionDisputeWindowNotOpen`. The value reaches the
staging through a new `evidenceTime` option of `stageOmittedInboundJoin` and a `timeConfig` override of
`syncSpectator`. This is a protocol input chosen for the test host's load, not a wait budget; no oracle
changed.

Engineer decision (Luka, 2026-10-12): `evidenceTime` 4 → 6 in U75e of
[BotConnectionFixes.test.ts](../../../test/unit/BotConnectionFixes.test.ts) (a leaving joiner whose landed join
a founder's timeout dispute reduces away), through the `timeConfig` override of `syncSpectatorAndPrepareJoin`;
the staging's other tests keep 4 s. The leaving joiner audits the founder's timeout dispute before it submits its
self-removal. Under full-gate load that audit took about 2 s and the self-removal was refused with
`RaceConditionDisputeEvidencePeriodExpired` 3 s after the window opened, so the reduction kept the joiner's
landed join. This is a protocol input chosen for the test host's load, not a wait budget; no oracle changed.

## Test timing inputs — 2026-10-10

Engineer decision (Luka, 2026-10-10): the harness baseline `MIN_TEST_TIME_CONFIG.p2pTime` is 5 instead of 2
([testTimeConfig.ts](../../../test/harness/core/testTimeConfig.ts)). Under load one staging step, such as a
join or an exit snapshot post, could idle the table longer than `p2pTime + agreementTime` (5 s), and the next
block then failed the receivers' subjective time check; the baseline now allows 8 s. Every derived wait grows
by 3 s (`participantTimeoutWaitMs` 15 → 18 s at height 0, `protocolEventTimeoutMs` 18 → 21 s); the measured
test phase of the full gate did not change. Luka also approved, the same day, the earlier per-test widenings
made for the same class of load failures, each with its measured reason:
`p2pTime: 15` in `stagePendingDisputerBehindLateAuditor`
([DisputeAuditStaging](../../../test/fixtures/DisputeAuditStaging.ts), a join idled the authors about 8 s) and
in `stageOutboundAroundAnchor` ([HistoricSyncStaging](../../../test/fixtures/HistoricSyncStaging.ts), an exit
snapshot post idled them about 9 s); `evidenceTime` 8 → 15 in
[case5_milestoneBlockContent](../../../test/e2e/disputeValidation/stateProof/case5_milestoneBlockContent.test.ts)
(three concurrent audits, the invalid one replayed over three tiers, took about 10 s against an 8 s kill
period); `evidenceTime: 12` in [MilestoneProofStartStaging](../../../test/fixtures/MilestoneProofStartStaging.ts)
(about 9 s audit path on a loaded farm); and the 15 s E19 window above. Luka approved one more the same day: `evidenceTime: 12` in
`stageOffWireTailOverBlindPendingAuditor` (MilestoneProofStartStaging, E15 and its control), where two
sequential audit and transaction rounds in one window took about 9 s against 8 s and the colluders' disputes
reverted with `RaceConditionDisputeEvidencePeriodExpired`. These are protocol inputs chosen for
the test host's load, not wait budgets; no oracle changed.

## Late dial close, exit-fallback race and evidence-window staging — 2026-10-09

Three intermittent failures were root-caused. First, after a lobby negotiation failed unsigned, the old
outbound dial socket's close could arrive after the new session's peer announcement. Its process-wide
in-flight mark made the peer look connected, the rematch dial was skipped with no log, and the peers never
reconnected, so the lobby E2E case for a new join after a leave during the handoff timed out. This is fixed
by session-scoped dial marks: each discovery session records its own in-flight dials, and the marks end with
the session, so a late close of a left session's dial can neither hide the peer from a later session nor clear
a later session's mark. Two
[discovery component cases](../verification/tests/test/utils/LocalDiscoveryServer.test.ts.md) cover it: a
rejoined topic dials the peer again while the left topic's closed socket has not finished closing
([`REQ-LOBBY-9-N894C0.T1.P32`](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0.t1.p32)),
and the rejoined topic's pending dial stays deduplicated across topics after the old socket finishes closing
([`REQ-LOBBY-9-N894C0.T1.P33`](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0.t1.p33)). Second, U121 in the [older-dispute audit report](../verification/tests/test/unit/DisputeAuditOlderDispute.test.ts.md)
now suppresses the held leaver's own dispute initiation, as the departed-disputer staging already does. Its
exit fallback could otherwise start a self-removal dispute beside the dispute the test constructs, and the
two stubbed constructions shared the fixture's pending auditing data. Third, E19 in the
[evidence-window report](../verification/tests/test/e2e/E2E-DisputeWindowEvidence.test.ts.md) uses the same
15-second evidence window as E47: the leader's audit, own dispute construction and submission could land after
the default 8-second window closed, which the contract rejects by design. No oracle changed in U121 or E19,
and neither change alters SDK or contract behavior. The E19 window is a fixture timing increase; Luka approved
it on 2026-10-10 (see the timing entry below).

## Discovery replacement and anchored-tail regression follow-up

Runs 420 and 421 invalidate any claim that one previous green full run established stability. Cost mode repeated the anchored-tail timestamp rejection; FIFO exposed a replacement-endpoint announcement lost during an old dial, followed by a reduction failure. The new discovery component cases force both pending-handshake and already-authenticated interleavings and require a different transport after the old socket closes. Existing restarted-spectator E2E coverage remains the integration oracle. Anchor staging requires the publication receipt and mirror convergence before constructing/auditing the dispute. Publication overlaps the two unfinalized tail blocks; the offline peer keeps the published anchor at block 2. The two new endpoint regressions fail against the original adapter and pass after its repair. Full cost run 425 exposed two additional staging dependencies: runtime recreation idled participant authoring, and E47 populated transaction metadata after its late wait. Runtime restart now overlaps ordinary authoring, and transaction metadata is populated before the unchanged deadline. Focused run 426 passed both cases; full cost run 427 passed all 3,404 tasks including both browser gates and Forge, with no starvation or infrastructure retries. FIFO run 428 caught a separate previous-block-signature staging race: its current-writer query overlapped subscribed audit replay. Capturing block 2’s writer before opening the window preserves the signature oracle. Focused run 429 passed; full FIFO run 430 then passed all 3,404 tasks with all tiers and no starvation or infrastructure retries. Cost run 431 exposed a separate exact join-deadline race on the shared node; its extracted test now owns its chain, pauses only that chain’s interval mining, and retains equality and one-second-expiry checks. All six join-signature tests passed in focused run 432. Run 433 showed that anchor staging still needed publication to overlap authoring; retaining receipt-before-tail chronology left estimation/mining inside the writer window. All 19 anchor-boundary cases passed in focused run 434. On the same final source/test tree, cost run 435 passed all 3,405 tasks in 297.69 s and FIFO (`-w 6`) run 436 passed all 3,405 in 351.81 s. Both completed 3,379 Mocha tasks, 24 Forge contracts and two browser gates with zero starvation or infrastructure retries. Node/browser typechecks, import lint and compile passed. These runs establish current passing evidence, not a claim that intermittent failures are impossible. Engineer approvals and the existing repository coverage/review backlog remain unchanged.

## Runtime cleanup and context regressions

The current verification includes a real delayed socket ready frame after manager disposal and rapid logger-context changes through main, SDK and executor roots. The latter asserts final identity and no echo to the sender. Domain cleanup cases inspect their retained inline endpoints after disposal; they do not use the disposed network for their assertions. The worker shutdown case checks repeated and concurrent cleanup through the harness surface. Exact assignments remain in the affected [logger](../verification/tests/test/utils/logging/LoggerService.test.ts.md), [discovery](../verification/tests/test/utils/LocalDiscoveryServer.test.ts.md), [EventBus](../verification/tests/test/stateManager/EventBus.test.ts.md) and [StateManager](../verification/tests/test/unit/StateManager.test.ts.md) reports. Repository-wide unmapped cases and duplicate assignments remain visible in the generated queues.

## Root lifecycle revision

The revision adds exact cases for standalone, empty, sibling and nested root disposal; second-parent rejection; concrete disposal typing; automatic diagnostics and removal; and broker attachment after readiness or disposal before attachment. Existing worker-failure fixtures now observe the root handle and distinguish fatal closure from detached reports. Browser peer coverage exercises both direct main-thread installation and the nested-worker port handoff. The worker gate covers 11 cases, including real transfer failure and proxy fallback. Final distributed evidence is pending and is not inferred from these focused results.

## Awaited RPC dispatch

The dispatch regression selection includes request and send completion, independent incoming calls, guard suppression/replay, peer error policies, loopback settlement, internal error attribution and custom-RPC E2E traffic. The two new cases observe the actual SDK router promise while a held endpoint is released by another RPC. Exact coverage is recorded in [RpcDispatch.test.ts](../verification/tests/test/rpc/RpcDispatch.test.ts.md). This targeted verification does not renew the full implementation audit or engineer approvals.

## Common lifecycle ownership

The seven [RuntimeLifecycle declarations](../verification/tests/test/rpc/RuntimeLifecycle.test.ts.md) use actual SDK roots and connections to check retained readiness, selected-child close rejection, child-first disposal, local cleanup after a real post failure, held child quiescence and rejection of upward cleanup. Focused run 272 passed 20 cases. Regression run 273 passed 188 cases, including SDK/executor startup and failure, runtime placement, worker shutdown, inline abort, bridge ownership and logger collection. This follow-up does not renew the full-plan audit or engineer approvals.

## Shared runtime RPC verification

The network-router extraction adds exact ownership, input-normalization and late-input cases through actual SDK roots and WebRTC channels. All 111 focused network cases passed, followed by 2,285 passing cases in full run 243. The browser worker gate passed all 11 declarations after replacing stale browser fake-manager staging with actual SDK-owned setup. Both full browser peer workflows passed, including application-worker bridge forwarding. All 11 impact-checker CLI tests also passed. The five WebRTC transport cases now use the real SDK and provider instead of a fake manager/channel; send and handshake observers delegate to production. Compile-time assertions reject unrelated root types and cross-category service/router/transport wiring. Current full-suite and platform evidence for the extraction is recorded in the implementation handoff; the older run below describes the pre-extraction state.

The pre-extraction functional state passed the full distributed gate in run-236: 2,280 passing and zero
final failures. One worker process termination and one starvation classification passed their
runner retries. Browser worker coverage passed all 11 cases, and the browser WebRTC gate passed
main-thread and nested-worker workflows. Both TypeScript builds, import lint, compile and all
11 isolated impact-checker CLI tests passed. The later callback-type/cast cleanup emits identical
JavaScript and passed both typechecks plus 39 focused distributed cases in run-237.

Communication fixtures use actual SDK-owned roots and channels. Their controls hold real endpoint
replies, inject actual frames, trigger synchronous clone/transfer failures and close owned
connections. The controllers do not implement request IDs, matching, timers or dispatch. Literal
cases cover pairwise settlement order, sender isolation, duplex calls, transfer detachment,
readiness, shutdown, worker errors, inline lifetime, logger topology and WebRTC ownership.

Exact Covers rows preserve moved IDs and withdraw only the approved standalone factory/no-route
credits. The folded logger declaration receives no per-origin summary credit. The former bare
factory zero-clock declarations have been replaced with SDK clock-initialization cases; those
cases do not prove an uninitialized Clock through SDK setup and receive no such credit.

Saved pre-extraction comparison runs use the same peer-service test selection, SDK/VM worker placement and worker
configuration. Accepted-test median runtimeReadyMs was 7,454 ms at the baseline and 7,174 ms after
the refactor; median test duration was 16,050 ms and 16,377 ms respectively. Neither run recorded
starvation. Worker assignment and speculative attempts differ, so these samples do not establish
a performance improvement.

The generated queues still contain pre-existing source/report gaps, unassigned permutations,
duplicate historical credits and pending engineer review. A successful non-strict refresh is not
full specification completeness. Changed fingerprints require engineer reverification; no approval
or review command was invoked.

## Contents

- [Current state](#current-state)
- [Why coverage is low](#why-coverage-is-low)
- [What was already fixed](#what-was-already-fixed)
- [Levers, in order of payoff](#levers-in-order-of-payoff)

## Current state

Direct, literal test declarations now cover all five local-status handshake routes, actual opened
participant sync, participant-read failure, closed/disposed completion, and replacement retirement.
Guard coverage also proves grace-overlap traffic on a replaced authenticated pipe and proves that
one transport's authentication cannot release another transport's queued calls. It also proves a
frame dispatched after local transport close cannot execute or punish the healthy replacement.
Typed SDK-edge recorders cover unauthenticated-profile ban/no-ban, current-versus-stale WebRTC
fallback, policy release with selected WebRTC, policy release with selected Holepunch during
non-preferred WebRTC overlap, release after the last WebRTC closes, healthy-WebRTC rejection of an
authenticated Holepunch attempt, usable fallback after current-WebRTC close, and permanent exclusion
of a later attempt. Block-queue evidence separately proves that ordinary same-fork future eviction
does not punish its valid supplier when the distinct exact-recovery failure path is suppressed.
Scoped fake time and randomness cover every relay selection/backoff branch, paired-event deduplication,
and pending-retry cancellation after success. The real Holepunch public surface covers join,
byte-equal leave, duplicates, no-op leaves, lazy creation, and restart replay.

Runtime transport tests cover delayed and rejected custom-root readiness in inline and worker modes. Worker-executor coverage includes delayed precompile readiness before worker return and concurrent success/error response correlation. Eleven direct cases cover complete and incomplete cross-module RPC-service and transport shapes, RPC symbol and `then` behavior, service-cache isolation, non-service rejection, native, compatible, and proxy-wrapped ethers Results, stable normalized output, and ordinary-array rejection. Five worker-hosted `ATransport` cases cover identity boundaries, replacement identity, trust classification, exact request/response serialization, expected and unexpected close behavior, close idempotency, and synchronous failure propagation. Three real-runtime RpcHandler cases plus the custom-RPC typecheck cover every delivery verb and target overload, unresolved fire-and-forget targets, local request rejection, timeout forwarding, compatible transport values, and the compile-time delivery-face split. All 27 EventBus component and runtime declarations map dispatch, subscription lifecycle, the one-shot `next` wait (filter, abort during the wait, an already aborted signal, detaching from the signal after an event), contract mirroring, cross-runtime fidelity, clone failures, and StateManager-owned custom-root disposal to exact obligations. The consuming application's production-preview browser test separately proves that a dynamically loaded custom RPC root can complete a real two-peer handshake and reach a playable hand across duplicated bundle graphs.

The ObjectChecks suite now covers every property, method, RPC-service, and Result-shape branch. The
ANetworkRpcService suite drives guard ordering, both delivery paths, every endpoint ownership boundary,
accessor non-execution, and capture-once invocation through the real runtime. The authenticated-peer
custom-RPC E2E rejects an Object-base method, disconnects only its sender, and proves a bystander
session remains usable.

Proxy-routing evidence now includes duplicate and codeless route rejection, execution through a
real registered facet, routed facet-error bubbling, and SDK-plus-consumer ABI preservation on both
sides of the runtime port.

RPC verification now uses the neutral specification as the only canonical `REQ-RPC-*` and
`INV-RPC-*` owner. Direct wire cases cover request and response decoding, invalid field types,
raw-bigint rejection, and the exact frame constant. Worker-hosted component cases cover every
implemented request settlement and race with pending-entry and timer cleanup. Separate guard
suites cover ordered short-circuiting, handshake queue/replay behavior, and the current
request-during-negotiation contradiction. The handshake guard suite also proves transport
retirement, owner disposal on both waiter outcomes, and late completion after timeout cannot revive
queued work or apply late punishment. Inline and worker runtime cases observe an unlocked
state mutex at RPC handler entry. Cancellation, aggregate resource limits, and compatibility
negotiation remain unassigned gaps. Handler and guard response-send failures now have direct
one-attempt, disconnect, and no-unhandled-rejection evidence.

The codec suite maps all 21 protocol schemas, all 22 fraud-proof schemas, the bigint and canonical-byte
boundary, EVM primitive/array/tuple decoding, nested Result conversion, and every public failure class.
The separate cross-module case owns compatible ethers Result normalization.

Seventeen direct EthersResultProxy cases map recursive conversion, direct and static method
boundaries, synchronous and asynchronous results, arguments, receiver/metadata preservation,
rejections, all supported listener verbs, repeated listener removal, event logs, query results, and
ordinary-member passthrough.

- Test IDs (planned permutations) evidenced: 930/4720 (20%).
- Specification IDs with at least one evidenced permutation: 87/251 (35%).
- Test declarations covering at least one ID: 570/1272 (45%); 20 files are
  excluded as out-of-scope developer tooling via `@spec-test-coverage-ignore`.
- One test may cover several IDs. Each assigned ID belongs to exactly one test; compliance is 100%.

## Why coverage is low

The assignment rule is strict on purpose: an ID is credited only when a single test demonstrably
exercises the whole defined scenario, including its oracle. Under that rule the gaps have four
distinct causes, and they need different fixes.

**1. Most planned IDs simply have no test yet (the dominant cause on the ID side).**
Atomization expanded template test plans into 4720 concrete scenarios — per fault class, per
signature violation, per boundary side, per proof type, per host. The suites were never written
against plans of that grain. 3790 permutations await a test; the
"Test IDs not tested" queue is now a literal to-write list, one test per row.

**2. Tests over surfaces that define no IDs at all (the dominant cause on the test side).**
Whole components define no `UNIT-TEST-*` families, so their tests have nothing to
claim: most of `test/models/` (Block.test.ts alone holds 44 declarations against ~6 defined
permutations), `test/utils/` helpers (HolepunchRelay, LogUploader, LoggerUtils,
SignatureCollectionMap), `test/evm/` infrastructure (EvmFactory, HostNonceManager, jumpdest cache,
worker shutdown), plus `test/cache/`, `test/harness/`, and `Clock.test.ts`. Fix: author obligations
for these components, or mark files out of scope where they test non-protocol tooling.

**3. Sibling tests of an already-claimed scenario.**
One-test-per-ID means that when several tests probe the same scenario, only the single strongest
demonstration carries the ID; the rest stay blank by design. This is concentrated in `test/unit/`,
`test/storage/`, and `test/e2e/` where suites deliberately probe one behavior from several angles.
These blank rows are not a defect and need no action.

**4. Weak oracles.**
The test drives the right scenario but does not assert the defined outcome, so full coverage cannot
be credited: duplicate-store tests asserting returned hashes but never the unchanged record, race
tests observing timeouts without the no-partial-state check, boundary tests using near-boundary
values (`now − 1` where the comparator rejects at `now`), rejection suites that never assert the
penalty-free half. Fix: strengthen the assertion, then claim the ID. Each report's Overview names
its cases.

## What was already fixed

- Local block-production coverage now holds two same-writer submissions behind the state mutex,
  releases them together, and proves that only one block commits at the shared coordinate while a
  current-height out-of-turn submission still fails.
- Snapshot-race coverage now proves both sides of the pending-inbound gate: SDK preparation stands
  down without a transaction while the JOIN is unconsumed, consumed JOIN state advances on-chain,
  and calldata prepared before a concurrent inbound arrival reverts on-chain. Forced-inclusion
  coverage separately proves reduction membership and the joiner's first successor-fork authoring
  turn. The duplicate `forceInboundJoin` harness case was removed because it called the same
  `joinChannel` contract entry as the already-mapped test.
- Join-admission coverage now separates snapshot and fork pin movement, tests both sides of the
  deadline boundary, assigns pending-participant top-up evidence, and drives an atomic deposit
  failure through the public join path.
- Join-authorization coverage now drives every collector failure mode through live peers, proves
  an expired collector sends no requests, checks real snapshot movement, exercises every responder
  validation branch and deadline boundary, and proves refusal keeps the session usable for retry.
- Bundled permutations ("each class", "valid and invalid") made full coverage impossible for most
  IDs; they were split into atomic one-scenario IDs (pool 1713 → 4218) with definition anchors.
  Evidence rose from 158 to 457 IDs without writing a single new test.
- The codec audit assigned complete evidence for all protocol/proof schemas, EVM result modes, and
  public failure paths.
- The ethers Result proxy audit assigned its full value, method, listener, event-log, query, and
  passthrough surface and added the missing direct cases.
- The coverage report previously omitted the 1163 REQ/INV permutations defined in implementation
  views; the queue and scores now cover the full pool.
- `test/scripts/` (112 declarations of runner tooling) is excluded with in-file ignore markers.

## Levers, in order of payoff

1. **Author obligations for the ID-less components** (cause 2) — unlocks ~200 currently
   unassignable test declarations.
2. **Strengthen weak oracles** (cause 4) — small test edits convert existing suites into evidence.
3. **Write tests against the atomized queue** (cause 1) — the long tail; the queue is exact and
   deduplicated, so progress is measurable per row.
4. Leave sibling tests (cause 3) alone; they are redundancy, not gaps.

## Targeted pre-open channel join evidence — 2026-08-31

The targeted suite covers the option matrix, fixed-topic matching, open races, exact-channel sync,
membership boundary, timeout/cancellation, explicit retry, failure phase, handoff, and host-local policy.
Runtime-port cases cover structured-clone options, dedicated cancellation routing, input validation, and
Boolean propagation. Matcher, negotiation, P2P, membership, state-application, block, harness-session, and
browser reports map their component boundaries. Participant-lifecycle evidence covers both pending-join fault
interleavings required by [`INV-MEMBERSHIP-PENDING-1-2H1T75` (Submitted joins are locally pending before acknowledgement)](../specification/peer-communication/join-authorization.md#inv-membership-pending-1-2h1t75).

RO5 is enforced as test architecture: a full connect fixture reaches a real terminal outcome and explicitly
settles detached work; an intermediate probe never launches the reusable full flow; teardown only reports a
leak. Normal Hyperswarm cross-topic deduplication remains an explicit verification gap.

## Focused safety evidence — 2026-09-01

Real loopback LocalDiscovery cases compare transport identities across close/reconnect, topic leave, and
blacklist. Two three-peer lobby cases hold negotiation after commitment, observe another authenticated local
connection, and prove that both successful completion and failed handoff release stop later replacement.
Membership cases observe pending status before contract invocation, preserve it after an uncertain submission,
and prove force join defers while on-chain membership is absent and while the window is expired before one
later eligible submission. Participant-lifecycle E2Es retain the two pending-fault receipt interleavings.

## Peer-fault consequence evidence — 2026-09-01

P2P manager probes cover authenticated oversized frames, malformed envelopes, unknown services,
unknown endpoints, local service exceptions, and stale-transport address fallback. Lobby evidence
separates neutral profile loss from repeated wrong-topic abuse. Handshake E2Es prove blacklist for
attributable timing, signature, and duplicate-ack faults, while response timeout remains
disconnect-only. Custom-RPC E2Es prove blacklist without affecting an unrelated session.

## Common root creation follow-up

[RootCreation](../verification/tests/test/rpc/RootCreation.test.ts.md) maps five exact real-SDK cases: both placements return a connection before ready, startup clone failures release their owned resources, and a pre-funnel worker failure preserves its cause while the same parent creates a replacement. Existing lifecycle, SDK, executor and system cases remain the evidence for domain ordering, cleanup, transfers and error behavior. The private root-creation implementation record records fresh command results and source fingerprints.

The first wider run found cleanup regressions; the focused recovery run passed all eight selected cases after preserving the existing inline-close and worker-global distinctions. Both typechecks, compile and import lint passed. The browser worker gate passed all eleven cases. The final distributed gate passed 2,301 tests; the browser P2P gate passed both main-thread and nested-worker paths. Repository-wide specification and impact queues remain visible; these results do not grant engineer fingerprint approval.

## Initialized root creation follow-up

The root-creation follow-up updates exact creation and initialization declarations and adds five RootErrorService cases through real SDK-owned roots. Lifecycle receive-order tests use real ready frames; creation tests await initialized roots. Historical results for the earlier connected-before-ready API do not verify the new readiness contract. Fresh evidence is recorded in the implementation follow-up.

Engineer approvals and review fingerprints remain engineer-owned. This update does not clear unrelated audit queues.

## Explicit root creation API

The free createRoot function now constructs local top-level roots or connected children with an explicit parent. Top-level application handlers stay local; child startup keeps the existing clone boundary. SDK root observation retains connection-before-observer and observer-before-child-start order. RootCreation adds two real SDK placement cases and retains child creation/failure recovery cases. Existing approval and impact queues remain unchanged by this API decision.

## Generic worker creation

Root classes now pass directly to createRoot. One platform worker creator takes an explicit URL, with no per-root factory or entry wrapper. Built-in roots use internal static worker entry URLs. Generic custom-root creation accepts an explicit URL; startup payloads do not carry child entry URLs. The shared worker globals use one path for all launched roots. Relevant startup, error, cleanup and browser evidence is being refreshed; engineer fingerprint approval remains pending.

## Client-root ownership and initialization

The application instance now references its initialized client root directly. The client root owns host communication and bridge resources. Application setup owns deployments and adapters; P2pInstance owns application listeners and logger cleanup. Common creation awaits initialization for every root. Top-level creation is inline and returns the root; worker creation returns the registered typed handle, and without an explicit parent it adds one hidden parent for that worker alone (see the parentless-worker section below). No raw bootstrap port is exposed by that handle.

The new creation cases exercise delayed standalone initialization, parentless worker creation and cleanup, held host readiness in both placements, independent deployments and cleanup after either deployment or client observation fails. Existing client error, timeout, disposal and browser bridge boundaries remain part of verification. A missing logger connection registration found by the report-a-bug E2E was restored; the focused collection and root-creation cases pass together. The focused teardown cases pass; the final full run is recorded in the implementation handoff. Existing generated queues remain unchanged. This update grants no engineer approval.

The engineer approved host shutdown preparation before the child cascade. Run-310 confirmed the earlier race in discovery fallback cleanup: the test body passed, then reduction calls rejected because the executor was closed. The host now invokes the existing StateManager stop-and-drain owner before common child disposal. Final local cleanup still runs after failure and repeated calls reuse completion. A separate startup cleanup change unregisters a host whose observation callback throws before parent attachment. Focused ordering, preparation-failure and teardown cases pass, including an executor read while preparation is held. Parented inline client creation uses host connection options and sends its disposal acknowledgement before closing the parent connection. Missing connection options reject before allocation. Both browser gates pass on this source state. Final full-run evidence and the unchanged generated queues are recorded in the implementation handoff.

## Application setup ownership correction

The user superseded review 4's application-heavy client root. Application setup now owns config, logger creation, adapters, two deployments and final assembly. The client root owns host communication and common lifecycle only; P2pInstance owns application cleanup. Root readiness means usable communication, while application setup still waits for deployment completion. Existing startup errors, parented and parentless workers, host preparation before child disposal and bridge behavior remain in scope. The focused and final evidence is recorded in the application-setup implementation follow-up. Engineer approval and existing queues remain unchanged.

## Host-only guard, local owners, parentless workers, and executor drain — 2026-09-29

The host-only guard suites this entry recorded were removed with the guard; the
[Application host root](#application-host-root--2026-10-16) entry records the evidence that replaces them.

The [RootCreation report](../verification/tests/test/rpc/RootCreation.test.ts.md)
drops the removed parentless-rejection case, maps the six parentless-worker cases and the inline-owner
case, and repairs the shifted declaration lines. The [EvmFactory report](../verification/tests/test/evm/EvmFactory.test.ts.md)
maps the owner-context and admission-drain cases and the existing bare-EVM composition case. The
late-admission case now also sends a late deploy and a late simulation, and all three settle with the
shutdown error without entering the EVM. Three new cases load a real precompile that answers, or fails,
1.5 seconds after it is called. For a late success, a late failure, and a deploy and a simulation
queued behind the late call, each reads that the caller settled with exactly `Contract executor shut down
before the operation finished`. A record-only wrapper on the real executor root's
`ContractExecutorService.admit`, restored in the same block, records each admitted operation's own
settlement; the assertions run only after every admitted operation has itself finished, the admitted
count is 1, 1 and 3, and no host executor error is recorded. They cover
[`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P6`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb)–[`UNIT-TEST-EXECUTOR-ADMISSION-1-RPE8YB.P8`](../implementation/source/src/rpc/internal/services/contractExecutor/ContractExecutorService.ts.md#unit-test-executor-admission-1-rpe8yb) and [`REQ-RUNTIME-3-VQXW59.T1.P79`](../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p79)–[`REQ-RUNTIME-3-VQXW59.T1.P81`](../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p81),
the stronger disposal-rejection contract the second review found unproven. The RootCreation report
also maps the new crashed parentless worker case: its worker thread exits during a real call, the call
rejects, the handle closes while the hidden parent is still live, and disposing the handle afterwards
leaves that parent disposing with no connections
([`UNIT-TEST-ROOT-CREATION-1-1NWN3V.P33`](../implementation/source/src/rpc/internal/createRoot.ts.md#unit-test-root-creation-1-1nwn3v), [`REQ-RUNTIME-3-VQXW59.T1.P82`](../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p82)).

The executor drain is deleted ([`OQ-IMPL-EXECUTOR-DRAIN-1-5D71YM` (Resolved executor admission drain bound)](../implementation/open-questions.md#oq-impl-executor-drain-1-5d71ym), Luke 2026-10-31), with unit and system
evidence. `EvmFactory > abandons an admitted call stuck on its precompile at once, closes the child, and
reports no error` never releases the held reply, asserts disposal completes in under 2 seconds, and reads
the closed child, the exact disposal rejection, the call count, and an empty host error list. `EvmFactory >
rejects an admitted precompile call and its queued deploy and simulation at once and disposes the
precompile child` reads the same rejection for all three callers. The late-admission case holds the
child's dispose request so the late calls reach the executor after admission closes. The admitted-failure
case and its permutations are deleted with their
obligation, and the late-completion cases use a fixed 1.5-second precompile delay. `RuntimeLifecycle > disposes a worker SDK while its worker executor call is in
flight` passes again: worker SDK disposal completes with the executor call still held, the SDK worker exits,
no host error is recorded, and a sibling keeps serving, so it now covers the worker-placement permutation
[`REQ-RUNTIME-3-VQXW59.T1.P78`](../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p78); Starting a consumer's own
`.ts` worker entry from another package's working directory is exercised only by consumer suites, not in
this repository.

The handshake-wait disposal fix has unit evidence for the service itself: `HandshakeCompletedGuard >
settles a pending handshake wait as not completed once the handshake service is released`
covers [`UNIT-TEST-INIT-HANDSHAKE-SERVICE-1-6N4C7R.P19`](../implementation/source/src/rpc/network/services/initHandshake/InitHandshakeService.ts.md#unit-test-init-handshake-service-1-6n4c7r): its probe runs the release the host root's
disposal calls with a pending wait, and the wait returns `false` long before its timeout. It does not
read a logger error directly; immediate settlement is what keeps any wait timer from outliving the logger.

## Application host root — 2026-10-16

The [ApplicationHostRoot report](../verification/tests/test/rpc/ApplicationHostRoot.test.ts.md) maps
[`REQ-RPC-9-8FFE6S.T1.P1`](../specification/peer-communication/rpc.md#req-rpc-9-8ffe6s.t1.p1)–[`REQ-RPC-9-8FFE6S.T1.P12`](../specification/peer-communication/rpc.md#req-rpc-9-8ffe6s.t1.p12),
[`UNIT-TEST-RESOLVE-HOST-ROOT-1-AS1DZ3`](../implementation/source/src/rpc/internal/roots/resolveHostRootManifest.ts.md#unit-test-resolve-host-root-1-as1dz3) and the two new host root entry permutations; the
[E2E report](../verification/tests/test/e2e/E2E-ApplicationHostRoot.test.ts.md) maps
[`REQ-RPC-9-8FFE6S.T1.P13`](../specification/peer-communication/rpc.md#req-rpc-9-8ffe6s.t1.p13) and [`REQ-RPC-9-8FFE6S.T1.P14`](../specification/peer-communication/rpc.md#req-rpc-9-8ffe6s.t1.p14). Every unit case starts a real runtime through the public setup,
isolated in the production SDK worker entry or inline, and calls the test application's probe service
through the typed host connection; no root, router or transport is replaced. In the disposal case a
probe call that never replies rejects with the runtime-disposed error when the client disposes, and a
later call rejects the same way; a disposal that waited for the call would never settle. The event cases assert
the listener ran by the time the emitting call replied, which the ordered runtime channel guarantees.
The E2E network case uses a new byzantine control that sends a real request over the authenticated
transport and returns how it settled. The removed host-only guard's test
plan and its unit family left no evidence behind. The suites have not run yet; the
engineer runs them. This update grants no engineer approval.

2026-10-17 update: the same report maps [`REQ-RPC-9-8FFE6S.T1.P15`](../specification/peer-communication/rpc.md#req-rpc-9-8ffe6s.t1.p15) and [`REQ-RPC-9-8FFE6S.T1.P16`](../specification/peer-communication/rpc.md#req-rpc-9-8ffe6s.t1.p16). The second-build case
calls `deployComplete` with two real local state machines, so without the guard the rebuild succeeds and
the case fails on the missing rejection. The separately built case bundles the probe root, the SDK host
root and the config module into one temporary module and keeps every other module shared, so the only
thing that sets the bundled config copy is the root's own configuration step; without that step the copy
keeps its default and the case fails. It covers the config copy only; it does not duplicate the clock,
logger or detached-work registry of a full application bundle.

## Milestone-only proof update — current assessment

The proof format now contains milestones only. Same-fork anchor clipping and explicit genesis
semantics replace the old separate signed-tail model. Historical membership hops include all
consumed JOINs and never subtract later slashes. Shared verification/replay tiers distinguish false
proof results from fatal execution or RPC failures. Per-step invalidity, below-anchor,
timeout-superseded and same-height final-conflict counters use the common predicates.

Sync retains verified reconstruction data and the latest proved final full state. An older anchor
state is not separately required once newer finality is established. Audit replay persists evidence
without signing or advancing the active view. Inbound-head races reload, rebuild and retry on real
progress; stopped progress or failed loading is fatal. Initial responders are selected from chain
eligibility, and founder discovery and join observation/expiry handling have corresponding tests.

Residual questions remain explicit in [specification questions](../specification/open-questions.md):
loss of the sole higher commitment after admission closes, late-challenge recovery, stale or
adoption-racing honest sync blacklists, admission gas/length caps and whole-data challenge cost.
Per-step checking does not prove constant total gas. Other existing findings remain unchanged
unless separately revalidated. Documentation and mappings remain pending engineer review; this
assessment grants no human approval and does not claim the repository's baseline coverage queues
are empty.

## Milestone proof review regressions

Focused real tests cover virtual finality from later signatures, the resulting on-chain conflict kill, audit evidence above a frozen view, both concurrent audit orders, chain/mirror anchor changes and sync across malformed skipped history. Force-join cases cover seating during a held membership read, a competing block trigger, successor-fork seating and a genuine expired evidence window. The fabricated window read was removed; its compound coverage claims were replaced by separate exact permutations. The omitted-data apply-handler comparison separates payload growth from an unrelated milestone walk. The documentation normalizer has a real CLI regression that restores prose definitions and remains byte-stable on a second run. The final canonical distributed gate passed all 3,306 runnable tasks after the source and test corrections. Failed earlier runs exposed stale test expectations and manually staged dispute-upload races; each was corrected and rerun. Existing skipped cases and repository-wide coverage queues remain separate from this evidence.

The additional exact-height [proof-owner tests](../verification/tests/test/unit/AgreementManagerProofConstruction.test.ts.md) check join and exit points with later union votes, rejection after removing the sole required later confirmation, a join point above an audit observer's frozen view, and a later target requiring two overlapping hops. Every positive case uses the real canonical verifier and asserts the exact final height and unchanged active view. These cover the participant-change gap left by the unchanged-membership virtual-finality regression.

The shared virtual-finality fixture holds unrelated subscribed calldata delivery while setting up proofs and connecting later auditors. Without that hold, normal fallback can deliver block 3 to its missing signer during spectator connection and change the scenario into direct finality at 3. The sequential and concurrent audit cases check the intended `[2,3]` milestone before auditing; both persistence orders retain their existing conflict and frozen-view oracles.

The shared join-hop fixture uses the same subscription-delivery control for its deliberately missing votes. Its frozen-view cases wait for a real fallback event to be held and require both expected milestone runs before auditing. This keeps compact audit evidence tied to the intended intermediate final snapshot even while spectator setup crosses the calldata-posting delay.
