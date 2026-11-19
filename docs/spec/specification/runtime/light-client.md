# Chain Reads Answered From Proven State

> **Agent status:** Maintained draft.
> **Engineer verification:** Pending.
> **Status:** Draft.

## Contents

- [Purpose and observable model](#purpose-and-observable-model)
- [Requirements and invariants](#requirements-and-invariants)
- [Assumptions and constraints](#assumptions-and-constraints)
- [Security considerations](#security-considerations)
- [Verification and test plan](#verification-and-test-plan)
- [Future Work](#future-work)

## Purpose and observable model

A participant reads the base chain through RPC endpoints
([chain-observation.md](./chain-observation.md)). An endpoint that answers a read is believed for the
answer. With the light client on, the participant does not take the answer: it has the endpoint prove
the state the read needs ([storage-proofs.md](./storage-proofs.md)) and works the answer out itself, a
contract call by running the contract in a local EVM over the proven state. To the caller nothing
changes: the same read gives the same answer the endpoint would give for the same block. The light
client is optional. A participant without it, or whose endpoint cannot serve it, reads as before, and
a participant whose light client fails keeps reading through the endpoint while the failure is made
known.

## Requirements and invariants

**<a id="req-lc-1-jt5pkt"></a>`REQ-LC-1-JT5PKT` — Reads at the latest block are answered from proven state of one block.** With the
light client on and served, a contract call, a storage read, a code read, a balance read and a
transaction count read that ask for the latest state MUST be answered from state proven under the
state root of the endpoint's best block at the time of the read, and the endpoint MUST NOT be asked
for the answer itself. The answer MUST equal the endpoint's own answer for that block: a returned
value, the data of a revert, and the block values a call reads. Everything one read uses MUST be
proven at one block. A read made after a transaction was mined MUST see that transaction's block or a
later one. What a call writes MUST NOT be visible to any later read. Reads made at the same time MUST
each get their own answer.

**<a id="req-lc-2-pmy1vg"></a>`REQ-LC-2-PMY1VG` — What cannot be answered from proven state goes to the endpoint.** The following
MUST be sent to the endpoint and are no failure: a read at a block other than the latest, a
transaction count that includes pending transactions, a call that carries a gas limit or fee fields the
endpoint must price, a call that reaches an address the chain serves with a precompile of its own, a
call that reads the hash of an earlier block, a call that fails without reverting, and every request
that is not one of the reads of [`REQ-LC-1-JT5PKT`](light-client.md#req-lc-1-jt5pkt). Each call so
left to the endpoint after it started locally MUST be counted apart from failures.

**<a id="req-lc-3-w7rrhm"></a>`REQ-LC-3-W7RRHM` — A failed read falls back to the endpoint and is made known.** When the light
client cannot answer a read it should answer, because a proof is refused or the endpoint does not give
what a proven read needs, the read MUST be answered by the endpoint instead, so that the participant
keeps working. Every such read MUST be logged as an error that tells a refused proof from any other
failure, and MUST be counted. A later read MUST be tried from proven state again.

**<a id="req-lc-4-e29y46"></a>`REQ-LC-4-E29Y46` — The light client is off unless switched on and served.** The light client MUST be
off by default; a participant with it off MUST send no request the plain chain access does not send.
Switched on, it MUST ask the endpoint once which methods it serves. When the endpoint does not list the
light client endpoints, every read MUST go to the endpoint as with the light client off, one error MUST
be logged that the endpoint does not support them, and the reads MUST be counted.

## Assumptions and constraints

- The chain is one whose state the participant can check: a Frontier chain with the constants and the
  chain precompiles of the configured chain. The first and only chain is peer3.
- The endpoint's best block is taken as the chain's ([storage-proofs.md](./storage-proofs.md)). The
  light client checks answers against that block; it does not check the block against the chain.
- The local EVM runs a call as Ethereum does. Gas is not charged as the chain charges it, so a call
  that depends on a gas limit is the endpoint's.
- Proven state is kept for one block. A read at the next block proves what it needs again.
- A fallback gives the participant the endpoint's unproven answer. The count and the error log are how
  an operator learns that reads are not being proven.

## Security considerations

Assets: the chain state a participant decides from. Trust boundary: the endpoint is untrusted for the
state it serves; the header of its best block is taken on its word. Threats and defenses: an endpoint
that answers a read with a wrong value is not asked for the value; an endpoint that proves a wrong
value is refused by the proof check; an endpoint that refuses to prove, or proves another block, makes
the read fall back to its unproven answer, which is the same trust a participant without the light
client gives, and the fallback is logged and counted so that it does not pass unseen. Residual risks:
an endpoint that lies consistently about which block is the best one, and a participant that ignores
the fallback count.

## Verification and test plan

### Requirement test matrix

| Plan item                                           | Requirements / invariants                            | Setup and stimulus                                                                                                                                                                                                                                      | Expected result                                                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-lc-1-jt5pkt.t1"></a>`REQ-LC-1-JT5PKT.T1` | [`REQ-LC-1-JT5PKT`](light-client.md#req-lc-1-jt5pkt) | Run a chain node of the test's own with the light client endpoints, deploy contracts, write their state by transactions, and read through the SDK's chain access with the light client on; a proxy between the two records what the endpoint was asked. | Each read gives the node's own answer and the endpoint is asked for none of the reads.                                            | <a id="req-lc-1-jt5pkt.t1.p1"></a>`REQ-LC-1-JT5PKT.T1.P1` — a contract call that returns a stored value; <a id="req-lc-1-jt5pkt.t1.p2"></a>`REQ-LC-1-JT5PKT.T1.P2` — a call that reverts with a reason; <a id="req-lc-1-jt5pkt.t1.p3"></a>`REQ-LC-1-JT5PKT.T1.P3` — a call that calls a second contract; <a id="req-lc-1-jt5pkt.t1.p4"></a>`REQ-LC-1-JT5PKT.T1.P4` — a call that returns the block's number, timestamp, coinbase, gas limit, randomness, base fee and chain id; <a id="req-lc-1-jt5pkt.t1.p5"></a>`REQ-LC-1-JT5PKT.T1.P5` — storage, code, balance and transaction count of a contract and of an account; <a id="req-lc-1-jt5pkt.t1.p6"></a>`REQ-LC-1-JT5PKT.T1.P6` — a read after each of two transactions that overwrite one slot; <a id="req-lc-1-jt5pkt.t1.p7"></a>`REQ-LC-1-JT5PKT.T1.P7` — reads after a call that writes; <a id="req-lc-1-jt5pkt.t1.p8"></a>`REQ-LC-1-JT5PKT.T1.P8` — five reads of two contracts made at once; <a id="req-lc-1-jt5pkt.t1.p9"></a>`REQ-LC-1-JT5PKT.T1.P9` — a call into one of Ethereum's precompiles, whose account is not proven |
| <a id="req-lc-2-pmy1vg.t1"></a>`REQ-LC-2-PMY1VG.T1` | [`REQ-LC-2-PMY1VG`](light-client.md#req-lc-2-pmy1vg) | The same setup; make reads the light client does not answer.                                                                                                                                                                                            | The endpoint answers each; nothing is logged as an error and no failure is counted.                                               | <a id="req-lc-2-pmy1vg.t1.p1"></a>`REQ-LC-2-PMY1VG.T1.P1` — a call and a storage read at an earlier block, a pending transaction count and a call with a gas limit; <a id="req-lc-2-pmy1vg.t1.p2"></a>`REQ-LC-2-PMY1VG.T1.P2` — a call that reaches the chain's own precompile and a call that reads the previous block's hash, each counted as left to the endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| <a id="req-lc-3-w7rrhm.t1"></a>`REQ-LC-3-W7RRHM.T1` | [`REQ-LC-3-W7RRHM`](light-client.md#req-lc-3-w7rrhm) | The same setup; the proxy answers one request of a proven read in the node's place.                                                                                                                                                                     | The read gives the node's answer, one error is logged and one failure counted per failed read, and the next read is proven again. | <a id="req-lc-3-w7rrhm.t1.p1"></a>`REQ-LC-3-W7RRHM.T1.P1` — an empty proof for a storage read and for a call's block values, logged as a refused proof; <a id="req-lc-3-w7rrhm.t1.p2"></a>`REQ-LC-3-W7RRHM.T1.P2` — the best block request rejected, logged as another failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| <a id="req-lc-4-e29y46.t1"></a>`REQ-LC-4-E29Y46.T1` | [`REQ-LC-4-E29Y46`](light-client.md#req-lc-4-e29y46) | Build the SDK's chain access with and without the light client switched on, over an endpoint with and without the light client endpoints.                                                                                                               | Off, it is the plain chain access; on without the endpoints, every read goes to the endpoint with one error logged.               | <a id="req-lc-4-e29y46.t1.p1"></a>`REQ-LC-4-E29Y46.T1.P1` — switched on over a node that does not list the endpoints: two reads answered by the node, counted, one error, the methods asked once and no best block asked; <a id="req-lc-4-e29y46.t1.p2"></a>`REQ-LC-4-E29Y46.T1.P2` — not switched on over an endpoint that lists them: a read goes to the endpoint and the methods are not asked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Future Work

_Non-normative._ Keeping proven state across blocks: the endpoint pushes the slots a block wrote
([storage-proofs.md](./storage-proofs.md)), and the participant re-proves what it holds at intervals.
Reading through the light client before the first block arrives. Comparing the best block with a
second endpoint. Chains other than peer3, and endpoints with another proof representation.
