# Light client report

This report answers the "Benchmark against the current SDK", "Measure time to verified readiness",
"Estimate concurrent subscriber capacity per RPC node", "Explain state freshness" and "Benchmark
fallback strategies before choosing one" sections of the Light Clients card (Trello 399). The farm
validation section of the card is a later step (S6) and is not covered here.

Status: measured on farm hosts on 2026-11-22 with a synthetic workload (see Results). Channel flows
of real participants (S5.0) are not measured yet.

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
  execution, with no re-run. It runs behind `LIGHT_CLIENT_FETCH_EACH_MISS`, a configuration for
  benchmarks (`REQ-LC-9-KWXV43`).
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
dependent read repeated at the same block, a call without a sender, and a balance. After the
comparison the losing strategies are removed.

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

**Example.** One call reads two slots of the followed contract and four slots of another contract
it calls, as a channel contract reads an ERC-20 balance. The test is
`reads the followed contract's slots from the push and proves another contract's account, then its slots, in two requests`
(`test/lightClient/LightClientFollowedChannel.test.ts`, `REQ-LC-9-KWXV43.T1.P11`).

- Pass 1: the caller's account, the followed contract's code and its two slots are held: the
  channel's transactions touched them, so the push carried them. The call reaches the other contract
  and finds its account and code missing. With no code for the other contract in this pass, the call
  stops there. The partition does not decide them, so one request proves the account and the code
  together: 2 keys.
- Pass 2: the other contract's code now runs and reads its four slots. All four are missing, and all
  four are known in this pass, because none depends on another: one request proves them together, 4
  keys.
- Pass 3: nothing is missing. The answer (21) equals the node's own `eth_call`, and the read counts
  as one that needed a fallback.

The account and code are known only after the call reaches the other contract, and the slots only
after its code has run. That is two dependent steps, so two requests. Reads that each name the next key cost one request per step, as the benchmark's chain walk shows. Stale
inputs do not arise inside one read: the partition's held values are re-proven at every accepted
block, and a fallback proof is asked for the read's own block. Altered and missing inputs are refused
by the tests of `test/unit/FrontierPushedPartition.test.ts`, for example
`refuses a pushed value the proof decides otherwise, and holds nothing until the next sync` and
`leaves to the node what the held proof does not reach`.

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
- Participants running whole channel flows on a peer3 node: that needs the parachain test mode of PR
  #606 with the light client switched on (S5.0). #606 was merged on 2026-11-22. Until then the
  share of calls the light client leaves to the node (gas estimates, calls with value, calls to the
  chain's precompile) is not measured: the synthetic calls contain none.
- The node's limit in subscribers is estimated, not measured: no step of either ramp failed.

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

### Pushes and reconnects

From the comparison run (one followed channel, 4 channels written per round):

- A push carried 2 values and 15 new proof nodes at the median (25 at p95), 8.3 KB. No block arrived
  with unchanged values but new proof nodes.
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
