# Light client report

This report answers the "Benchmark against the current SDK", "Measure time to verified readiness",
"Estimate concurrent subscriber capacity per RPC node", "Explain state freshness" and "Benchmark
fallback strategies before choosing one" sections of the Light Clients card (Trello 399). The farm
validation section of the card is a later step (S6) and is not covered here.

Status: the calls, readiness and first capacity ramps were measured on farm hosts on 2026-11-22 with a
synthetic workload (see Results). Channel flows of real participants were measured on 2026-11-23 to
2026-11-26, and capacity again on 2026-11-25 and 2026-11-26 with a workload taken from those flows
(Channel flows, Capacity with the flows' workload). The fallback strategy was chosen on 2026-11-26.

## What is compared

- **Current path:** the SDK with the light client off. Chain reads go to the RPC node, and the
  event-built mirror answers the local-first and replicated reads.
- **Light client path:** the SDK with the light client on against a peer3 node started with
  `--light-client`. Reads at the latest block are answered from the partitions the node pushes, or
  from proofs fetched at the same block, and replicated reads go to the chain
  (`REQ-MIRROR-5-N5SZC9`).

Both paths replay the same blocks and calls. Every light client answer is also compared with the
node's answer pinned to the same block hash (compare mode, `LIGHT_CLIENT_COMPARE_READS`,
`REQ-LC-11-MTCBF9`), so a benchmark run is also a correctness run.

## How it is measured

The SDK needs no extra counters for this. The numbers come from outside it:

| Quantity                                                  | Source                                                                                                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RPC requests per method, and requests removed             | the WebSocket proxy between peer and node (`test/fixtures/node/RpcNodeProxy.ts`), path off against path on                                                                                                   |
| Remote simulations                                        | `eth_call` and `eth_estimateGas` requests the proxy forwarded                                                                                                                                                |
| Fallback round trips and keys per call                    | `state_getReadProof` requests the proxy forwarded between one call's start and end, calls issued one at a time                                                                                               |
| Hit rate per call kind                                    | keys a following light client proved, against the keys a light client that follows nothing proved for the same calls                                                                                         |
| Reconnect time                                            | from dropping the peer's socket at the proxy until the light client holds the node's new sync                                                                                                                |
| Calls served from pushed state, with a fallback, by nodes | the provider's `lightClientCounters`                                                                                                                                                                         |
| Push bytes, values changed, proof nodes refreshed         | each push the proxy delivered, and `newNodes` in the provider's `pushedBlockTimings`                                                                                                                         |
| Stage times                                               | `executedAt`, `builtAt`, `sentAt` from the node, `receivedAt`, `verifiedAt` from the peer                                                                                                                    |
| Node CPU, memory, outbound bytes                          | the node process's `/proc` entries on its host, node started with and without `--light-client`                                                                                                               |
| Peer CPU and memory                                       | per call, the peer process's CPU (`process.cpuUsage`); per push, the time the peer's thread spends verifying and applying it; the peer threads' heap after a full collection, and what each added peer costs |
| Backlog and dropped updates                               | at the peers: `sentAt` drifting behind `executedAt`, gaps in pushed block numbers, resubscriptions                                                                                                           |

Stage times compare clocks of two processes, so node and peers run on one host for the readiness
numbers. Capacity runs put the node on its own host.

The node's own cost is measured per path, each in a run of its own on a fresh node
(`BENCH_PATHS=<path> yarn bench:light-client`): the current path against a node without
`--light-client` (`BENCH_NODE_LIGHT_CLIENT=0`), which is today's node; the current path against a
node with it, which shows what recording the touched keys costs the node when nobody subscribes; and
each light client path. The calls of all paths on the same blocks are compared in one run of all
paths on one node. One call set per round leaves the node mostly producing blocks, so the runs that
measure its cost per path raise the calls with `BENCH_CALL_SETS`, the times each path runs the call
set per round.

Development runs use a local dev node. Reported numbers come from farm hosts taken out of the test
pool for the run, with their CPU, memory and network stated next to each result.

No pass or fail targets are set. Capacity is reported as the whole ramp: for each subscriber count,
latency by stage (median and p95), backlog, drops, node CPU, memory and outbound bytes, the first
resource to saturate, and the run's duration. A load level counts as sustained when the backlog does
not grow and no update is dropped. Measured numbers and extrapolated estimates are kept apart. The capacity driver is
`scripts/bench/lightClientCapacity.ts` (`yarn bench:light-client:capacity`). A writer writes a
random share of the channels each block and leaves the rest idle. Each simulated peer has a socket
of its own and takes every push through the SDK's `FrontierPushedPartition`, the code the light
client itself runs, and a set share of the peers also proves one key outside its partition at each
block. Peers run in worker threads, whose busy share is reported so that a saturated harness is not
mistaken for a saturated node. With `BENCH_NODE_URL` the driver attaches to a node on another host,
whose CPU and memory are then measured there.

## Fallback strategies

What the light client does today when a call reads state that no push holds: it runs the call with
placeholders for the missing state, collects every miss that pass found, fetches them in one
`state_getReadProof` at the same block, and runs the call again from the start. A key that only an
earlier read reveals costs another pass. This is the card's strategy 2 (batch the keys known
together), with re-execution as its cost.

The other two:

- **Strategy 1:** prove each missing value when the call reaches it and continue the same
  execution, with no re-run. It ran behind `LIGHT_CLIENT_FETCH_EACH_MISS`, a configuration for
  benchmarks, and was removed on 2026-11-26 (Choice, below).
- **Strategy 3:** send the call to an RPC node for a remote simulation. The current path does exactly
  this for every call, so its cost per call is measured there. A remote result carries no proof: it
  is a trusted answer, not a verified one. The card sends it to another RPC node. The peer3 dev node
  takes no peers, so a second node cannot follow the first and serve the same blocks. The two costs
  are measured apart in the per-path runs instead: the current path alone on a node of its own gives
  the remote simulation's cost on a node that pushes nothing, and a light client path alone gives the
  serving node's push and proof cost (engineer decision, 2026-11-22). In the run of all paths on one
  node, a remote simulation shares the node with the pushes, so its latency there includes that load.

The driver, `scripts/bench/lightClientCalls.ts` (`yarn bench:light-client`), runs the current path
and both light client strategies over one node, on the same blocks and calls, each behind its own
proxy. The calls cover a slot the followed channel holds, a simulated write, a read of another
contract (one slot, four slots known together, eight slots that each name the next), the same
dependent read repeated at the same block, a call without a sender, a call that writes and reverts
with an error message (added after the 22 Nov runs: a revert is compared as `revert:<data>`, and in
compare mode against the node's), and a balance. After the comparison the losing strategies were
removed (Choice, below).

The driver also measures:

- **Call outcomes.** For each light client path: the share of calls answered entirely from pushed
  state, the share that needed a fallback, and, for those, the spread and histogram of the keys and
  round trips each call proved itself. A call that used a proof an earlier call fetched at the same
  block needed a fallback but proved nothing, so it counts at 0.
- **Hit rate.** A fourth path, `cold`, is a light client that follows nothing, so it proves every key
  a call reads. For each call kind, the hit rate of a following path is 1 minus the keys it proved
  divided by the keys the cold path proved. A key one call proved is held for the later calls at the
  same block, on both paths alike, so a key counts at the first call kind of a round that reads it.
- **Transactions over several channels.** With `BENCH_CHANNELS_PER_TX=k` one transaction writes k
  channels, as the state channel manager's `multicall` can. Every channel such a transaction logs
  gets all the keys it touched, so a run with k > 1 against a run with k = 1 shows what that costs
  the followed partition: keys held (the values of its sync), values and proof nodes per push, and
  push bytes.
- **Reconnects.** Every `BENCH_RECONNECT_EVERY` rounds the proxy drops each following path's socket
  and accepts the reconnect at once. Recorded per drop: the time until the light client holds the
  first push after it, whether that push was a sync, and its size. The node's new sync is part of
  its CPU, so the runs that measure the node's cost per path set `BENCH_RECONNECT_EVERY=0`.

### Choice (2026-11-26)

Strategy 2 stays. In the 22 Nov calls, keys known together cost strategy 2 one request (4 keys, 9 ms)
against 4 requests (19 ms) for strategy 1; on a chain of 8 slots that each name the next, strategy 1
was 12% faster and spent 26 against 38 ms of peer CPU, because strategy 2 runs the call again. In the
channel flows a steady-state round needed 0.96 to 1.19 requests to the node with the light client on,
and 0.11 once received blocks stopped reading their commitment (Channel flows), so how a miss is
fetched changes little there. Strategy 1 is removed, with its
configuration and its two tests. Strategy 3, the node's own simulation, stays only where the light
client does not answer: a read that fails falls back to it (`REQ-LC-3-W7RRHM`), and calls with gas
fields or value go to it (`REQ-LC-2-PMY1VG`). `OQ-SPEC-LC-2-XQ3PR7` item 7 records the choice.

## State freshness

This section follows one read through the code, from the request to the answer.

**What "latest" means.** A read at the latest block (`eth_call`, `eth_getStorageAt`, `eth_getCode`,
`eth_getBalance`, `eth_getTransactionCount`) is answered at one block: the newest block that a
subscription on the serving endpoint pushed and the light client accepted. Only the serving
endpoint's pushes count; another endpoint's pushes cannot move the block
(`src/evm/p2pRuntime/rpcNodes/lightClient/LightClient.ts`, `newestPushedBlock`). When no
subscription holds a block, the read is made at the serving endpoint's best block, from
`chain_getHeader` (`FrontierProvenStateReader.head`).

**How the block and its state root are learned.** Each push carries a Substrate header and the
Ethereum header of that block. The light client hashes the Substrate header, takes its state root,
and checks that the Ethereum header hashes to the Ethereum block hash the header's digest names
(`FrontierPushedPartition.take`). The block values a call reads (number, timestamp, base fee) come
from that Ethereum header. The Substrate header itself is taken on the endpoint's word: no validator
signature is checked, so an endpoint that invents a consistent header and the state under it is not
caught. This is the trust the card allows.

**A peer that is behind.** The read must not be answered below a block floor: the highest block the
serving endpoint has shown, in its new heads, the logs it delivered, and the receipts, blocks, logs
and block numbers it answered, a pending block excepted (`LightClientRpcProvider`,
`highestSeenBlocks`, `seenBlockNumbers`, `noteDeliveredLog`). A read whose newest pushed block is
below the floor waits for that push for at most one block time (`pushedBlockAtFloor`). When the wait
times out, the read is made at the endpoint's best block, through proofs. If that best block is below
the floor too, the read is left to the endpoint, logged and counted as failed (`headAtFloor`). Tests:
`reads at the block of a log the serving endpoint delivered, waiting for its push` and
`leaves a read to the endpoint as a failed one when the endpoint's best block is below the block it has shown`.

**A newer head during a call.** The block is fixed when the read starts. Every pass of the read runs
at that block under a lock, and every fallback proof is asked for that block's hash. A push that
arrives during the call is accepted into the partition, but the running read keeps its block: one
read sees one block. The next read starts at the newer block. When the block moves, the state held
for the old block is dropped (`moveTo`).

**When proofs are verified.** At three points.

1. On receipt of a push. Every key the partition holds, pushed now or earlier, is read again from the
   held proof nodes under the new state root, and must equal the value the partition holds. A message
   that fails is refused, the partition holds nothing, and the subscription syncs again. So "apply"
   and "verify" are one step: a push is held only once it has verified
   (`FrontierPushedPartition.take`).
2. When a read reaches a value. The partition decides it from the nodes it already holds
   (`FrontierPushedPartition.decide`). This covers keys the push named and keys whose path the held
   nodes happen to cover.
3. When a fallback proof arrives. `state_getReadProof` at the read's block, verified against that
   block's state root (`FrontierProvenStateReader.read`, `FrontierStorageProofVerifier`,
   `FrontierAccountProofVerifier`).

**Verified data, proven absence and missing evidence.** One check tells them apart:
`SubstrateTrieProof.read`. It walks the key's path from the state root through nodes it holds. A
value at the end of the path is verified data. A path that ends at an empty node, a branch with no
child for the next nibble, or a node whose partial key departs from the key is proven absence:
`null`, which the storage verifier turns into a zero slot. A node on the path that the proof does not
hold throws `StorageProofError`. In the partition that means "undecided", and the key goes to a
fallback request. In a fallback proof the read fails: it is logged as an error, counted as failed,
and answered by the endpoint. A read is never answered from a guess.

**When a pushed proof suffices and when a fallback runs.** A call runs in passes
(`LightClient.run`). In each pass, state not held answers a placeholder and is recorded as missing
(`LightClientState`). After the pass, the partitions decide what they can at the read's block. What
is left is proven in one `state_getReadProof` request at that block, and the call runs again from the
start. A pass that finds nothing missing gives the answer. The read counts as served from pushed state
only if nothing it used came from a fallback proof, including one fetched for an earlier read at the
same block.

**Example.** A followed channel's contract reads an ERC-20 balance it holds: `tokenHolding` of the
test contract `LightClientProbe` reads the holder's address from one of its own slots, then asks an
ERC-20 (`LightClientToken`) for that holder's balance and for its supply. The test is
`reads an ERC-20 balance of a holder the push names, proving the token's account and code, then its balance and supply together, and proves them again at a later block`
(`test/lightClient/LightClientFollowedChannel.test.ts`, `REQ-LC-9-KWXV43.T1.P12`).

At the first block:

- Pass 1: the caller's account, the followed contract's code and the slot naming the holder are held:
  the channel's transaction wrote that slot, so the push carried it. These reads are verified. The
  call reaches the token and finds its account and code missing; with no code in this pass, the call
  stops there. The partition does not decide them, so one request at the read's block proves the
  account and the code together: 2 keys.
- Pass 2: the token's code runs. The balance's key, `keccak256(holder, slot)`, is known only now, from
  the holder read in pass 1 and the code fetched for pass 2. The supply's key is known in the same
  pass, and neither depends on the other: one request proves both together, 2 keys.
- Pass 3: nothing is missing. The answer (1,000 of 1,000) equals the node's own `eth_call`, and the
  read counts as one that needed a fallback.

At a later block, after a transfer of 300 that no channel transaction logged, so no push carried it:

- What the first read proved belongs to the earlier block, so it is stale. When the newer push moves
  the light client to the new block, everything held for the earlier one is forgotten (`moveTo`). The
  same two requests run again, both for the new block's hash, and the answer is the new balance (700),
  equal to the node's. With the forgetting removed, the test fails.

So keys known in the same pass (the balance and the supply) are proven together, and keys that only
an earlier read reveals (the token's code, then the balance's key) cost one request per step. The same
holds for reads that each name the next key, as the benchmark's chain walk shows. Stale inputs do not
arise inside one read: the partition's held values are re-proven at every accepted block, and a
fallback proof is asked for the read's own block. Altered and missing inputs are refused by the tests
of `test/unit/FrontierPushedPartition.test.ts`, for example
`refuses a pushed value the proof decides otherwise, and holds nothing until the next sync` and
`leaves to the node what the held proof does not reach`. The four-slot version of this example, with
a contract that is not a token, is
`reads the followed contract's slots from the push and proves another contract's account, then its slots, in two requests`
(`REQ-LC-9-KWXV43.T1.P11`).

## Event coverage

A partition holds only what the transactions that logged the channel's id touched. The contracts
were audited for that on 2026-11-21: every state channel manager function that writes a channel's
storage logs the channel's id, in `topics[1]`, on every path that writes. No gap was found and
nothing was changed. The audit, its scope and its notes are in the
[implementation assessment](spec/audit/implementation.md#event-coverage-of-the-state-channel-manager--2026-11-21).
What it leaves to measurement, the slots only calls read, shows in the hit rate the calls driver
measures.

## Not covered

Where the build departs from the card is listed in
[`OQ-SPEC-LC-2-XQ3PR7`](spec/specification/open-questions.md#oq-spec-lc-2-xq3pr7).

- Collator and full-node import costs: capacity runs against one dev node with interval sealing, not
  a relay-chain network.
- The 22 Nov synthetic ramps never missed a step, so their limits (about 35,000 distinct, 43,000
  shared) are extrapolated. The ramps with the flows' workload were run to their first miss.
- The skipped commitment read (`03b28d3ec`) was measured in the flows on a development machine only,
  not on the farm.
- Watched-key expiry was not measured on its own in the capacity ramps (Capacity with the flows'
  workload).
- A warm run serves one warm-up flow before the measured one. A node that has served many channels
  for hours, with a manager holding their storage, was not measured.

## Results

Measured on 2026-11-22. Node: `zero-fee-node` built from peer3-parachain `b47ecb2` (node PR #3), dev
mode with interval sealing, one block every 2 s. SDK: branch `lc-399-benchmarks` (#613). Hosts: farm
workers testing1 to testing5, each 8 cores of an AMD EPYC 9645, 16 GB, Debian 13, taken out of the
test pool for the runs. Their clocks agreed within 0.6 ms (NTP), which bounds the error of stage
times measured across hosts. Every run's `results.json` is kept in `logs/bench/` of the machine that
ran it; none is in the repository.

### Correctness

One run of all four paths on the same blocks, with every light client read also asked of the node at
the same block hash (`BENCH_COMPARE=1`, 60 rounds): 540 of 540 reads matched on each light client
path, 0 differed, 0 were not compared. Results agreed across the four paths in every round, and no
error was logged.

### Calls: requests, node CPU and latency

Each path ran alone on a fresh node, 5 times, 30 rounds of 10 call sets (2,700 calls per run, 29
blocks, about 90 s), on testing1. Node CPU is the node process's, over the whole run; mean and
standard deviation of the 5 runs.

| Path                                                   | Node CPU per run | Requests to the node     | Calls answered locally |
| ------------------------------------------------------ | ---------------- | ------------------------ | ---------------------- |
| Current, node without `--light-client`                 | 2.27 ± 0.16 s    | 2,712 (2,100 `eth_call`) | 0                      |
| Current, node with `--light-client`, nobody subscribed | 2.24 ± 0.12 s    | 2,712                    | 0                      |
| Light client, strategy 2 (`batchPerPass`)              | 1.07 ± 0.04 s    | 434 (420 proofs)         | 2,700                  |
| Light client, strategy 1 (`fetchEachMiss`)             | 1.07 ± 0.04 s    | 524 (510 proofs)         | 2,700                  |
| Light client following nothing (`cold`)                | 2.17 ± 0.13 s    | 5,323 (2,610 proofs)     | 2,700                  |

- Following the channel removed 84% of the requests (2,712 to 434) and 53% of the node's CPU on this
  call mix. Recording what transactions touch costs the node nothing measurable while nobody
  subscribes (2.24 against 2.27 s).
- A light client that holds no partition costs the node as much as the current path: its proofs
  replace the calls.
- The share of calls served entirely from pushed state is 44% (240 of 540) on this mix, and the per-key
  hit rate 42%. Both are properties of the synthetic mix, 4 of whose 9 call kinds read only the
  followed channel: every read of the channel's own state came from the push (hit rate 1.0), reads of
  other contracts from proofs (hit rate 0.08 to 0.25). The real share needs S5.0.

Latency per call kind, first call set of each round (nothing held yet at that block), 5 runs pooled,
150 calls per cell: median / p95, and requests per call.

| Call                                           | Current (remote, strategy 3) | Strategy 2       | Strategy 1        |
| ---------------------------------------------- | ---------------------------- | ---------------- | ----------------- |
| Slot of the followed channel                   | 3.2 / 4.4 ms, 1              | 2.0 / 3.2 ms, 0  | 1.9 / 3.3 ms, 0   |
| Call reading the followed channel              | 3.6 / 4.6 ms, 1              | 4.4 / 5.9 ms, 0  | 4.3 / 5.6 ms, 0   |
| Simulated write to the followed channel        | 4.1 / 5.7 ms, 1              | 2.6 / 4.1 ms, 0  | 2.3 / 4.1 ms, 0   |
| Another contract, 1 slot                       | 3.8 / 4.8 ms, 1              | 14 / 55 ms, 2    | 13 / 56 ms, 2     |
| Another contract, 4 slots known together       | 3.7 / 4.7 ms, 1              | 9.1 / 11.9 ms, 1 | 18.7 / 23.1 ms, 4 |
| Another contract, 8 slots each naming the next | 3.5 / 4.3 ms, 1              | 101 / 116 ms, 10 | 89 / 97 ms, 10    |
| The same 8-slot call again at the block        | 3.4 / 4.4 ms, 1              | 2.2 / 3.0 ms, 0  | 2.3 / 2.9 ms, 0   |
| Call without a sender                          | 3.2 / 4.1 ms, 1              | 6.8 / 9.0 ms, 1  | 6.2 / 7.8 ms, 1   |
| Balance of the sender                          | 2.8 / 3.5 ms, 1              | 1.3 / 1.5 ms, 0  | 1.3 / 1.5 ms, 0   |

What this says about the strategies, with the node on the same host, where a remote call took about
3.5 ms:

- Reads the push holds are answered locally as fast as or faster than a remote call, with no request.
- Keys known together favour strategy 2 (one request for 4 keys, 9 ms) over strategy 1 (4 requests,
  19 ms). Keys that each name the next cost both one request per step; strategy 1 is 12% faster there
  because it does not run the call again.
- A remote simulation (strategy 3) answers every call in one request of about 3.5 ms, but its answer
  is the node's word, not verified, and it is the node CPU the light client exists to save.
- Over the whole mix, strategies 1 and 2 cost the same node CPU (1.07 s); they differ only in requests
  (524 against 434) and in which call kinds they make slower.

Peer work and bytes per call, from the same calls: the peer's CPU (median / p95) and the bytes the
call's requests and replies carried. The peer's CPU is the driver process's during the call, so it
also holds the proxy forwarding the call's requests and any push that arrived meanwhile.

| Call                                           | Current             | Strategy 2              | Strategy 1              |
| ---------------------------------------------- | ------------------- | ----------------------- | ----------------------- |
| Slot of the followed channel                   | 0.8 / 3.5 ms, 231 B | 1.0 / 4.0 ms, 0 B       | 0.9 / 3.6 ms, 0 B       |
| Call reading the followed channel              | 0.7 / 4.5 ms, 352 B | 3.5 / 7.6 ms, 0 B       | 3.3 / 7.4 ms, 0 B       |
| Simulated write to the followed channel        | 1.5 / 4.7 ms, 480 B | 1.6 / 8.7 ms, 0 B       | 1.3 / 5.8 ms, 0 B       |
| Another contract, 1 slot                       | 1.4 / 4.2 ms, 360 B | 9.9 / 19.1 ms, 14.1 KB  | 9.1 / 16.9 ms, 14.1 KB  |
| Another contract, 4 slots known together       | 0.9 / 2.3 ms, 680 B | 5.9 / 12.5 ms, 4.2 KB   | 8.9 / 18.3 ms, 11.4 KB  |
| Another contract, 8 slots each naming the next | 0.8 / 2.6 ms, 296 B | 38.0 / 56.1 ms, 36.9 KB | 26.3 / 39.7 ms, 36.9 KB |
| The same 8-slot call again at the block        | 0.7 / 2.2 ms, 296 B | 1.2 / 4.2 ms, 0 B       | 1.3 / 2.1 ms, 0 B       |
| Call without a sender                          | 0.6 / 1.7 ms, 300 B | 3.6 / 8.0 ms, 4.1 KB    | 2.8 / 7.5 ms, 4.1 KB    |
| Balance of the sender                          | 0.5 / 1.2 ms, 178 B | 0.3 / 0.5 ms, 0 B       | 0.2 / 0.5 ms, 0 B       |

- The light client moves work from the node to the peer. Over a whole run (2,700 calls, 29 blocks)
  the node saved 1.20 s of CPU (2.27 against 1.07 s: about 41 ms per block, 0.44 ms per call), and the
  peer spent 4.71 s (strategy 2) or 4.23 s (strategy 1) against 2.25 s on the current path.
- Running the call again is strategy 2's cost: on the 8-slot chain it took 38 ms of peer CPU against
  26 ms for strategy 1. Fetching keys known together one by one is strategy 1's: 8.9 against 5.9 ms,
  and 11.4 against 4.2 KB.
- Missing keys per call that needed a fallback, 5 runs (7,500 such calls of 13,500 on each light
  client path): 6,900 proved nothing themselves, because an earlier call at the same block had
  fetched what they read; 150 each proved 1, 3, 4 and 11 keys. Round trips per such call: strategy 2
  0 (6,900), 1 (300), 2 (150), 10 (150); strategy 1 0 (6,900), 1, 2, 4 and 10 (150 each). So 600 of
  13,500 calls (4.4%) fetched a proof of their own; the rest of the 56% needing a fallback read
  proofs fetched earlier at the block.

### Pushes and reconnects

From the comparison run (one followed channel, 4 channels written per round):

- A push carried 2 values and 15 new proof nodes at the median (25 at p95), 8.3 KB. Blocks whose
  partition values stayed unchanged while their proof path moved are not isolated in these runs: the
  drivers counted a push as unchanged only when it carried no value at all, and every push also
  carries the account of whoever sent the block's transactions, whose nonce changes with each one. The
  drivers now count the followed contract's slots instead (`contractValueCount` in
  `scripts/bench/benchUtils.ts`, reported as `unchangedValuesWithNewProofNodes` against
  `changedValues`); the measurement comes with the next farm runs.
- Stages, median: the node built a push in 2 ms, dispatched it in under 1 ms, transit took 1 ms, the
  peer verified and applied it in 2 ms; 5 ms from the end of the block's execution to verified.
- Reconnect, from dropping the socket until the light client held the node's new sync: 302 ms median,
  307 ms max (6 drops per path), the sync carrying the partition's 7 values.
- One transaction writing 4 channels (`BENCH_CHANNELS_PER_TX=4`, as a multicall over channels does):
  the followed partition held 13 values instead of 7, a push carried 5 values and 17 new proof nodes
  (34 at p95) and 9.4 KB instead of 8.3 KB, and a reconnect took 259 ms.

### Capacity

The node ran on testing1 with its RPC open on port 9944 only to the peer hosts (a firewall allowlist).
Simulated peers ran on testing2 to testing5, 8 threads per host, each peer with a socket of its own,
verifying and applying every push with the SDK's `FrontierPushedPartition`. The ramp driver ran
elsewhere and started the peers over ssh. Each step ran 60 s after a 10 s warm-up. 10% of peers also
proved one key outside their partition at each block. Node CPU and memory are per-minute samples of
the node process taken during the step, so they are approximate.

Shared partitions: 20 channels, half written each block, so up to 1,600 peers followed one
partition.

| Subscribers | Peer hosts | Delivered          | End to end median / p95 / max | Out of the node | Node CPU (1 core = 100%) | Node memory | Busiest peer thread |
| ----------- | ---------- | ------------------ | ----------------------------- | --------------- | ------------------------ | ----------- | ------------------- |
| 3,200       | 3          | 96,000 of 96,000   | 122 / 246 / 371 ms            | 13 MB/s         | 20-30%                   | 0.6 GB      | 12%                 |
| 6,400       | 3          | 192,000 of 192,000 | 224 / 430 / 711 ms            | 26 MB/s         | about 40%                | 0.9 GB      | 23%                 |
| 12,800      | 3          | 384,000 of 384,000 | 442 / 833 / 1,265 ms          | 51 MB/s         | about 80%                | 1.0 GB      | 45%                 |
| 19,200      | 3          | 595,200 of 595,200 | 667 / 1,252 / 1,644 ms        | 78 MB/s         | about 110%               | 1.2 GB      | 68%                 |
| 25,600      | 4          | 768,000 of 768,000 | 642 / 1,212 / 1,679 ms        | 101 MB/s        | about 160%               | 1.8 GB      | 66%                 |
| 32,000      | 4          | 960,000 of 960,000 | 790 / 1,482 / 2,036 ms        | 125 MB/s        | about 170%               | 1.9 GB      | 80%                 |

Distinct partitions: one channel per peer (up to 20,000 channels), about 20 written each block, so
almost every partition is idle in a given block.

| Subscribers | Delivered          | End to end median / p95 / max | Node builds the push | Out of the node | Node CPU   | Node memory | Busiest peer thread |
| ----------- | ------------------ | ----------------------------- | -------------------- | --------------- | ---------- | ----------- | ------------------- |
| 1,000       | 30,000 of 30,000   | 97 / 138 / 218 ms             | 59 ms                | 5 MB/s          | about 20%  | 0.6 GB      | 4%                  |
| 2,000       | 60,000 of 60,000   | 180 / 258 / 374 ms            | 112 ms               | 10 MB/s         | 15-25%     | 0.7 GB      | 7%                  |
| 4,000       | 120,000 of 120,000 | 350 / 488 / 656 ms            | 213 ms               | 21 MB/s         | about 35%  | 1.4 GB      | 14%                 |
| 8,000       | 240,000 of 240,000 | 674 / 919 / 1,189 ms          | 418 ms               | 41 MB/s         | about 55%  | 2.1 GB      | 27%                 |
| 12,000      | 360,000 of 360,000 | 1,038 / 1,391 / 1,754 ms      | 654 ms               | 60 MB/s         | about 110% | 2.2 GB      | 40%                 |
| 16,000      | 480,000 of 480,000 | 1,390 / 1,842 / 2,243 ms      | 880 ms               | 81 MB/s         | about 140% | 2.6 GB      | 51%                 |
| 20,000      | 600,000 of 600,000 | 1,761 / 2,331 / 2,746 ms      | 1,133 ms             | 99 MB/s         | about 170% | 3.9 GB      | 67%                 |

Measured, both ramps: every step was sustained. No push was missing, skipped or refused, no
subscription ended, every peer opened, and the lag of a step's last third was within a few ms of its
first third. The largest measured counts are 32,000 subscribers on shared partitions and 20,000 on
distinct ones. At 20,000 distinct partitions the p95 is above the 2 s block time: the slowest 5% of
peers hold a block more than one block late, without falling further behind.

Stages per step, median / p95 in ms. Proofs delivered is pushes per second, one push per peer per
block, each carrying its proof. Verify and apply is the time a peer's thread spent on one push, so it
is the peer's CPU per block for keeping its partition. The slowest peer is the one with the highest
median end to end in the step. Initial sync is from opening the subscription to the first verified
sync, with all of a step's peers opening at once. Fallback is one proof of a key outside the
partition, read by 10% of peers at each block.

Shared partitions:

| Subscribers | Proofs delivered | Build | Dispatch  | Transit   | Verify and apply | Slowest peer end to end | Initial sync  | Fallback  |
| ----------- | ---------------- | ----- | --------- | --------- | ---------------- | ----------------------- | ------------- | --------- |
| 3,200       | 1,600/s          | 3 / 6 | 31 / 62   | 84 / 189  | 1.2 / 2.8        | 243 / 282               | 208 / 374     | 49 / 145  |
| 6,400       | 3,200/s          | 3 / 5 | 67 / 134  | 148 / 309 | 1.2 / 2.5        | 460 / 539               | 269 / 807     | 77 / 232  |
| 12,800      | 6,400/s          | 3 / 7 | 135 / 281 | 294 / 587 | 1.2 / 2.6        | 927 / 1,041             | 364 / 1,223   | 142 / 439 |
| 19,200      | 9,600/s          | 3 / 7 | 178 / 412 | 466 / 904 | 1.2 / 2.6        | 1,357 / 1,515           | 645 / 2,024   | 213 / 686 |
| 25,600      | 12,800/s         | 3 / 7 | 235 / 553 | 370 / 769 | 1.2 / 2.5        | 1,316 / 1,486           | 2,220 / 3,755 | 173 / 572 |
| 32,000      | 16,000/s         | 3 / 5 | 305 / 685 | 451 / 888 | 1.1 / 2.5        | 1,598 / 1,970           | 391 / 1,561   | 206 / 659 |

Distinct partitions:

| Subscribers | Proofs delivered | Build         | Dispatch  | Transit   | Verify and apply | Slowest peer end to end | Initial sync  | Fallback  |
| ----------- | ---------------- | ------------- | --------- | --------- | ---------------- | ----------------------- | ------------- | --------- |
| 1,000       | 500/s            | 59 / 68       | 10 / 20   | 24 / 59   | 1.6 / 3.5        | 133 / 164               | 91 / 223      | 12 / 43   |
| 2,000       | 1,000/s          | 112 / 127     | 16 / 33   | 50 / 118  | 1.6 / 3.5        | 254 / 323               | 118 / 193     | 28 / 89   |
| 4,000       | 2,000/s          | 213 / 240     | 33 / 67   | 97 / 210  | 1.6 / 3.2        | 499 / 569               | 173 / 335     | 55 / 164  |
| 8,000       | 4,000/s          | 418 / 473     | 73 / 161  | 174 / 352 | 1.6 / 3.0        | 966 / 1,048             | 344 / 644     | 87 / 272  |
| 12,000      | 6,000/s          | 654 / 726     | 110 / 229 | 264 / 520 | 1.5 / 3.0        | 1,455 / 1,615           | 1,211 / 2,344 | 124 / 400 |
| 16,000      | 8,000/s          | 880 / 1,004   | 154 / 327 | 337 / 653 | 1.5 / 3.0        | 1,917 / 2,091           | 498 / 2,163   | 157 / 496 |
| 20,000      | 10,000/s         | 1,133 / 1,253 | 204 / 434 | 415 / 793 | 1.6 / 3.0        | 2,501 / 2,659           | 2,008 / 3,907 | 189 / 601 |

- A peer's cost per block does not grow with the subscribers: 1.1 to 1.6 ms to verify and apply a
  push of about 9 KB (shared) or 11 KB (distinct) carrying 13 to 14 new proof nodes at the median.
  No fallback read failed.
- The slowest peer is late by dispatch and transit, not by its own work: its dispatch and transit
  are about twice the median peer's, its verify and apply time the same.
- A peer's heap, after a full collection, was 26 to 31 KB per subscriber at 8,000 subscribers and
  more. Below that the figure scatters (3 to 74 KB) and is not used.
- Initial sync varies between steps without a trend; all of a step's peers open at once.

Where the time goes: the node's CPU stayed under 2 of 8 cores and its outbound traffic reached 1 Gbit/s
without either saturating. End-to-end time grows in proportion to the subscribers, in two places:

- Building a push grows with the number of distinct partitions, about 0.057 ms each, because the node
  proves every subscribed key at each block, idle partitions included (`OQ-SPEC-LC-1-VKHDPN` item 9).
  With 20 shared partitions it stays at 3 ms.
- Dispatch and transit grow with the number of sockets: the node sends a block's pushes one
  subscriber after another, 0.024 to 0.031 ms each (median dispatch plus transit, divided by the
  subscribers).

Estimated, not measured: building alone would take the whole 2 s block time at about 35,000 distinct
partitions, and from there the node falls behind whatever the subscribers. On shared partitions the
p95 would pass the block time at about 43,000 subscribers. Both are linear extrapolations of the
tables above; no step at those counts was run, because the peer hosts were the limit: 80% busy at
32,000. Node memory grows by about 190 KB per distinct partition, so 35,000 would need about 7 GB.

What limited the measurement, not the node: one peer host through an ssh tunnel stopped at 3,200
subscribers (the tunnel's file limit, then its single `sshd` process), and three peer hosts were 95%
busy at 25,600, which added a third to the latency (913 against 642 ms median, the four-host run).
The node's own `--rpc-max-connections` (100 by default) was raised to 50,000 for these runs.

The workload is synthetic: a writer contract and one key per partition write. Real channel flows,
whose partitions hold more keys, would make each push larger and each build longer.

### Channel flows

Measured on testing1 (8 cores of an AMD EPYC 9645, 16 GB) on 2026-11-25 and 2026-11-26, and on a
development machine where stated. Driver: `scripts/bench/lightClientFlows.ts`
(`yarn bench:light-client:flows`). Each flow is a test of the SDK's own suite: three participants run
a channel on a peer3 node started for that one flow, so every run is a cold start for the node and
the peers. Requests are everything the proxy forwarded to the node, summed over the flow's peers,
median of 3 runs with min-max. Off is the SDK with the light client off; on is SDK `69332517e` with
watched keys, against node `6bf84b6`, the same node for both.

| Flow             | Off           | On            | On against off |
| ---------------- | ------------- | ------------- | -------------- |
| transitions      | 60            | 95 (93-96)    | +58%           |
| steadyState      | 114 (114-115) | 105 (102-109) | -8%            |
| snapshot         | 78            | 113           | +45%           |
| deposit          | 101           | 160 (156-162) | +58%           |
| leaveAndWithdraw | 76            | 122 (119-134) | +61%           |
| rejoin           | 99            | 134 (132-137) | +35%           |
| dispute          | 323 (317-324) | 340 (328-341) | +5%            |

A cold flow costs more requests with the light client on. The flows are short: a peer lives 3 to 20 s
in them, 2 to 10 blocks. In that time the light client pays its start-up and gains little:

- Each peer's 4 start-up reads (`P2pRuntimeHostRoot`: the protocol times, the gas limit, the replay gas
  and the participant limit) cost 17 to 22 proof requests and 4 header requests, against 4 calls off.
- With the light client on, reads the event-built mirror answers without a request go to the chain
  (`REQ-MIRROR-5-N5SZC9`): in transitions, 30 such reads off against 87 to 94 answered on.
- The first push of a new channel's subscription was empty in 5 of the 6 flows measured on 2026-11-23:
  the channel has no transaction yet when the peer subscribes.

**Steady state.** `steadyState` runs the `transitions` flow with 9 more rounds of the channel, so
(steadyState - transitions) / 9 is the cost of one round once the peers follow their channel. Mean of
the 3 repeat pairs, requests per round:

| SDK                                               | Node      | Where               | Cold              | Warm            |
| ------------------------------------------------- | --------- | ------------------- | ----------------- | --------------- |
| light client off                                  | `6bf84b6` | testing1            | 6.04              |                 |
| on, before watched keys (`66daf0585`)             | `6bf84b6` | testing1            | 3.44              |                 |
| on, watched keys (`69332517e`)                    | `6bf84b6` | testing1            | 1.19 and 0.96     | 1.67            |
| on, watched keys (`69332517e`)                    | `6bf84b6` | development machine | 0.89              | 2.33            |
| on, no commitment read when in time (`03b28d3ec`) | `827ca0d` | development machine | 0.11 (0, 0, 0.33) | 0 (0, -0.67, 0) |

Warm runs a warm-up flow on the same node before the measured one, so the node has served other
peers and the state channel manager holds more storage. Warm cost more per round than cold (1.67
against 0.96) because of one read: validating each received block read the block's calldata
commitment on chain, a key that is never written, and with more manager storage that read needed the
node more often (cold 6 to 16 of 72 such reads per run, warm 23 to 29, five runs each). Since
`03b28d3ec` a block received in time does not make that read at all (`REQ-BLOCK-PIPE-8-N529VH`). On the
same development machine a round then cost 0.11 cold and nothing warm: in 4 of the 6 pairs the 9
extra rounds added no request, and the others differ by 3 requests, the spread between repeats of one
flow. That run is not from the farm.

**Correctness.** Every flow ran once more in compare mode, where each read the light client answered
was also asked of the node at the same block: 900 of 900 matched on 2026-11-25, 907 of 907 on
2026-11-26, 895 of 895 warm. No read failed, no push was refused and no subscription restarted in any
run.

**The card's 99%.** Fewer RPC calls by 99% is not reachable in these flows, whatever the light client
does. 13 to 23% of a flow's requests with the light client off must reach a node (measured on
2026-11-23): sending a transaction, its gas estimate and receipt, the nonce at the pending block, and
the subscriptions.
Over a whole cold flow the light client costs more requests, not fewer (table above). In steady state
it removes 98% of a round's requests on the development machine (0.11 left of 6.04 measured off on the
farm), which is the card's case of repeated calls once the state is held; 99% of a round would leave
0.06, below the spread between repeats, so the measurement cannot tell 98% from 99% there.

### Capacity with the flows' workload

The 22 Nov ramps above wrote one key per partition and watched nothing. On 2026-11-25 and 2026-11-26
the ramps ran again with a workload taken from the channel flows on the farm:

| Item                  | Flows (steadyState and transitions, per peer)  | Workload                                   |
| --------------------- | ---------------------------------------------- | ------------------------------------------ |
| Subscriptions         | 2: the channel's and the manager's (no topics) | 2                                          |
| Channel partition     | 110 keys at the push of the channel's open     | 110 keys per channel                       |
| Steady push           | median 0 to 3 keys written, at most 11         | 3 keys per busy channel per block, 20 busy |
| Watched keys at start | 47 to 55                                       | 50, watched after the first message        |
| Peers per channel     | 3                                              | shared ramps 3, distinct ramps 1           |

Node: peer3-parachain `6bf84b6` (2026-11-25 ramps) and `827ca0d` (2026-11-26), dev mode, one block
every 2 s, on testing1 behind a firewall that admits the peer hosts only. Driver on testing1, peers on
testing2 to testing5. Each step ran 60 s after a 10 s warm-up, and a ramp stopped at its first step
that was not sustained, twice per model. A step is sustained when every push arrived and no watch
failed. The table gives the largest step sustained in both rounds, the largest whose end-to-end p95
stayed within 2 s, and the first step missed.

| Watched set per subscriber                        | Partitions | Sustained     | p95 within 2 s | First miss              |
| ------------------------------------------------- | ---------- | ------------- | -------------- | ----------------------- |
| 50 keys                                           | distinct   | 1,100         | 600            | 1,200                   |
| 50 keys                                           | shared     | 1,200 or more | 600            | 1,800 (peer hosts busy) |
| 1,024 keys                                        | distinct   | 150           | 100            | 200                     |
| 1,024 keys                                        | shared     | 100           | 100            | 150                     |
| 50 keys + 96 watched ahead, moved every 16 blocks | distinct   | 400           | 400            | 500 and 600, once each  |
| 50 keys + 96 watched ahead, moved every 16 blocks | shared     | 450           | 450            | 600                     |

On distinct partitions this is about 18 times lower than the 22 Nov ramp (20,000), because a push now
carries a partition of 110 keys with 3 of them written, and the node builds and sends each subscriber's push one after another
on a single thread. At 1,100 distinct subscribers building the pushes took 1.77 s of the 2 s block
(p95 1.97 s); with 1,024 watched keys each subscriber's push re-proved all of them, about 12 ms per
subscriber and a 92 KB watch push.

Which row applies: before 2026-11-26 every received block made one commitment read, a key never
written, and each such key stayed watched, so a long-running peer filled its 1,024 places (third
and fourth rows). Watching the commitments of the next 32 heights ahead kept them bounded (last two
rows) but cost about 60% of the node's capacity, and was removed when the read itself was removed:
a block received in time no longer reads its commitment (`REQ-BLOCK-PIPE-8-N529VH`), and watched keys
now expire 64 blocks after the last watch that named them (`--light-client-watched-key-blocks`). The
first two rows are the model for the code as it is, measured without the expiry; the expiry adds at
most one watch of the 50 keys per subscriber every 65 blocks, which was not measured on its own.

For 10,000 players in channels of 3 (the shared rows), one node per 1,200 or more subscribers gives at
most 9 nodes at the capacity limit, or about 17 nodes with the p95 within 2 s (600 per node).

Measured with the farm drained of tests; results, logs and scripts are kept outside the repository
with the bench notes of 2026-11-25 and 2026-11-26.
