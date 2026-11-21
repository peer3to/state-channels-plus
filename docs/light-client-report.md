# Light client report

This report answers the "Benchmark against the current SDK", "Measure time to verified readiness",
"Estimate concurrent subscriber capacity per RPC node", "Explain state freshness" and "Benchmark
fallback strategies before choosing one" sections of the Light Clients card (Trello 399). The farm
validation section of the card is a later step (S6) and is not covered here.

Status: method only. No section below has measured numbers yet.

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

| Quantity                                                  | Source                                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| RPC requests per method, and requests removed             | the WebSocket proxy between peer and node (`test/fixtures/node/RpcNodeProxy.ts`), path off against path on     |
| Remote simulations                                        | `eth_call` and `eth_estimateGas` requests the proxy forwarded                                                  |
| Fallback round trips and keys per call                    | `state_getReadProof` requests the proxy forwarded between one call's start and end, calls issued one at a time |
| Calls served from pushed state, with a fallback, by nodes | the provider's `lightClientCounters`                                                                           |
| Push bytes, values changed, proof nodes refreshed         | each push the proxy delivered, and `newNodes` in the provider's `pushedBlockTimings`                           |
| Stage times                                               | `executedAt`, `builtAt`, `sentAt` from the node, `receivedAt`, `verifiedAt` from the peer                      |
| Node CPU, memory, outbound bytes                          | the operating system (cgroup statistics on the farm hosts), node started with and without `--light-client`     |
| Peer CPU and memory                                       | the operating system, per peer process                                                                         |
| Backlog and dropped updates                               | at the peers: `sentAt` drifting behind `executedAt`, gaps in pushed block numbers, resubscriptions             |

Stage times compare clocks of two processes, so node and peers run on one host for the readiness
numbers. Capacity runs put the node on its own host.

The node's own cost is measured per path, each in a run of its own on a fresh node
(`BENCH_PATHS=<path> yarn bench:light-client`): the current path against a node without
`--light-client` (`BENCH_NODE_LIGHT_CLIENT=0`), which is today's node; the current path against a
node with it, which shows what recording the touched keys costs the node when nobody subscribes; and
each light client path. The calls of all paths on the same blocks are compared in one run of all
paths on one node.

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
  is a trusted answer, not a verified one.

The driver, `scripts/bench/lightClientCalls.ts` (`yarn bench:light-client`), runs the current path
and both light client strategies over one node, on the same blocks and calls, each behind its own
proxy. The calls cover a slot the followed channel holds, a simulated write, a read of another
contract (one slot, four slots known together, eight slots that each name the next), the same
dependent read repeated at the same block, a call without a sender, and a balance. After the
comparison the losing strategies are removed.

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
What it leaves to measurement, the slots only calls read, shows in the per-slot hit rate below.

## Not covered

- Collator and full-node import costs: capacity runs against one dev node with interval sealing, not
  a relay-chain network.
- Participants running whole channel flows on a peer3 node: that needs the parachain test mode of PR
  #606 with the light client switched on (S5.0), which follows once #606 is merged.

## Results

None yet.
