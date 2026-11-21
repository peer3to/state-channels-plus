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

Development runs use a local dev node. Reported numbers come from farm hosts taken out of the test
pool for the run, with their CPU, memory and network stated next to each result.

No pass or fail targets are set. Capacity is reported as the whole ramp: for each subscriber count,
latency by stage (median and p95), backlog, drops, node CPU, memory and outbound bytes, the first
resource to saturate, and the run's duration. A load level counts as sustained when the backlog does
not grow and no update is dropped. Measured numbers and extrapolated estimates are kept apart.

## Fallback strategies

What the light client does today when a call reads state that no push holds: it runs the call with
placeholders for the missing state, collects every miss that pass found, fetches them in one
`state_getReadProof` at the same block, and runs the call again from the start. A key that only an
earlier read reveals costs another pass. This is the card's strategy 2 (batch the keys known
together), with re-execution as its cost.

The comparison adds, behind a test-only option:

- **Strategy 1:** fetch a proof for each miss when it is found and continue the same execution,
  with no re-run.
- **Strategy 3:** send the call to another RPC node for a remote simulation. A remote result
  carries no proof, so it is a trusted answer, not a verified one.

All three run identical calls pinned to one block hash, including dependent reads and repeated
calls after the cache is filled. After the comparison the losing strategies are removed.

## Not covered

- Collator and full-node import costs: capacity runs against one dev node with interval sealing, not
  a relay-chain network.
- Participants running whole channel flows on a peer3 node: that needs the parachain test mode of PR
  #606 with the light client switched on (S5.0), which follows once #606 is merged.

## Results

None yet.
