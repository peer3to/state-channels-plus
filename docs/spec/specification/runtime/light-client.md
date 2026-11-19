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

Proving everything again at every block costs requests. For the contract of a channel the
participant follows, the endpoint pushes every block, with the contract's proven writes when the
block concerns the channel. The participant keeps that contract's storage across blocks with them and
proves all of it again at an interval.

## Requirements and invariants

**<a id="req-lc-1-jt5pkt"></a>`REQ-LC-1-JT5PKT` — Reads at the latest block are answered from proven state of one block.** With the
light client on and served, a contract call, a storage read, a code read, a balance read and a
transaction count read that ask for the latest state MUST be answered from state proven under the
state root of the endpoint's best block at the time of the read, and the endpoint MUST NOT be asked
for the answer itself. The answer MUST equal the endpoint's own answer for that block: a returned
value, the data of a revert, and the block values a call reads. Everything one read uses MUST be
proven at one block. The storage of a followed contract is the one exception: it MAY be brought to
the read's block as [`REQ-LC-5-MM0BM9`](light-client.md#req-lc-5-mm0bm9) allows. A read made after a transaction was mined MUST see that transaction's block or a
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

**<a id="req-lc-5-mm0bm9"></a>`REQ-LC-5-MM0BM9` — The storage of a followed contract is carried across blocks only by pushed blocks that reach the read's block.**
The participant can be told to follow a channel of a contract, and to stop. While a channel of a
contract is followed and the endpoint serves the light client endpoints, the participant MUST hold one
subscription for that contract and the log topics of its followed channels on every connection to an
endpoint, MUST subscribe again on a connection that reopens, and MUST end the subscription when no
channel of the contract is followed. Each block the endpoint pushes is checked as
[storage-proofs.md](./storage-proofs.md) requires. For a read at a block, storage of a followed
contract held at an earlier block MUST be used without a new proof only when the participant accepted
a pushed block for every block after the earlier one up to the read's block, each naming the one
before it as its parent and the last one being the read's block. The writes of those blocks MUST then
be applied, in block order, to the slots held. When the pushed blocks do not reach the read's block
that way, every slot held of the contract MUST be proven again at the read's block in one request
before the read is answered. Only storage is carried: the contract's balance, transaction count and
code, the block values, and everything of any other account MUST be proven at the read's block. A
slot that is not held MUST be proven when it is first read, also when a pushed block wrote it. Storage
of a contract that is no longer followed MUST NOT be carried. With an endpoint that does not serve the
light client endpoints the participant MUST NOT subscribe.

**<a id="req-lc-6-nefa2n"></a>`REQ-LC-6-NEFA2N` — Carried storage is proven again at an interval.** The interval is a configured
number of blocks, a positive integer; another value MUST be refused before any endpoint is contacted.
At the first read at a block that is the interval or more after the block at which the held storage
of a followed contract was last proven whole, every slot held of the contract MUST be proven again at
the read's block in one request, also when the pushed blocks reach that block. A slot whose proven
value differs from what the pushed blocks led to MUST take the proven value, MUST be counted, and a
warning MUST be logged once per such proof.

**<a id="req-lc-7-w8wdn3"></a>`REQ-LC-7-W8WDN3` — A refused pushed block is not used and is made known.** A pushed block that
[storage-proofs.md](./storage-proofs.md) rejects, or that is no such block, MUST NOT change what is
held and MUST NOT count as a block the participant accepted. It MUST be counted and logged as an
error. A read that would have needed it is answered as
[`REQ-LC-5-MM0BM9`](light-client.md#req-lc-5-mm0bm9) requires for pushed blocks that do not reach the
read's block; it is no failed read.

**<a id="req-lc-8-bbyc51"></a>`REQ-LC-8-BBYC51` — A participant follows the channel it has selected.** When a participant selects
a channel, it MUST tell its chain access to follow that channel of the channel's contract, with the
channel's id as the log topic. When it clears the selection, selects another channel or is disposed,
it MUST tell its chain access to stop. Chain access without the light client MUST ignore both.

## Assumptions and constraints

- The chain is one whose state the participant can check: a Frontier chain with the constants and the
  chain precompiles of the configured chain. The first and only chain is peer3.
- The endpoint's best block is taken as the chain's ([storage-proofs.md](./storage-proofs.md)). The
  light client checks answers against that block; it does not check the block against the chain.
- The local EVM runs a call as Ethereum does. Gas is not charged as the chain charges it, so a call
  that depends on a gas limit is the endpoint's.
- Proven state is kept for one block, except the storage of a followed contract. A read at the next
  block proves what else it needs again.
- The endpoint pushes every block it imports to a subscription, in block order. A block in which no
  log of the contract carries a subscribed topic comes with its header alone. A slot of the followed
  contract that such a block wrote stays as held until the held storage is proven again, so an answer
  can differ from the endpoint's own for up to the interval. The channel's contract is assumed to log
  the channel's id in every transaction that writes what the channel's reads use; the interval bounds
  the harm where it does not, and belongs inside the shortest on-chain deadline.
- A pushed block proves the writes it lists, not that the list is complete.
- A read that arrives before the pushed block of its block proves the held storage itself; it does
  not wait.
- The held storage of a followed contract grows with every slot read and is proven again whole.
- One block pushed over two connections is one block. Blocks pushed while a connection was down are
  not read again.
- A fallback gives the participant the endpoint's unproven answer. The count and the error log are how
  an operator learns that reads are not being proven.

## Security considerations

Assets: the chain state a participant decides from. Trust boundary: the endpoint is untrusted for the
state it serves; the header of its best block is taken on its word. Threats and defenses: an endpoint
that answers a read with a wrong value is not asked for the value; an endpoint that proves a wrong
value is refused by the proof check; an endpoint that refuses to prove, or proves another block, makes
the read fall back to its unproven answer, which is the same trust a participant without the light
client gives, and the fallback is logged and counted so that it does not pass unseen. An endpoint that pushes a
wrong write is refused by the same proof check, and the refusal is logged and counted. An endpoint
that leaves a write out of a pushed block, or pushes a block's header alone although the block
concerned the channel, is believed until the held storage is proven again at the interval; the
changed slots are then counted and a warning is logged. An endpoint that pushes nothing, or blocks
that do not link, makes every read prove the held storage itself. Residual risks: an endpoint that
lies consistently about which block is the best one, a participant that ignores the fallback count,
and what a participant decides from a carried slot inside the interval.

## Verification and test plan

### Requirement test matrix

| Plan item                                           | Requirements / invariants                            | Setup and stimulus                                                                                                                                                                                                                                                                                                                                             | Expected result                                                                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-lc-1-jt5pkt.t1"></a>`REQ-LC-1-JT5PKT.T1` | [`REQ-LC-1-JT5PKT`](light-client.md#req-lc-1-jt5pkt) | Run a chain node of the test's own with the light client endpoints, deploy contracts, write their state by transactions, and read through the SDK's chain access with the light client on; a proxy between the two records what the endpoint was asked.                                                                                                        | Each read gives the node's own answer and the endpoint is asked for none of the reads.                                                   | <a id="req-lc-1-jt5pkt.t1.p1"></a>`REQ-LC-1-JT5PKT.T1.P1` — a contract call that returns a stored value; <a id="req-lc-1-jt5pkt.t1.p2"></a>`REQ-LC-1-JT5PKT.T1.P2` — a call that reverts with a reason; <a id="req-lc-1-jt5pkt.t1.p3"></a>`REQ-LC-1-JT5PKT.T1.P3` — a call that calls a second contract; <a id="req-lc-1-jt5pkt.t1.p4"></a>`REQ-LC-1-JT5PKT.T1.P4` — a call that returns the block's number, timestamp, coinbase, gas limit, randomness, base fee and chain id; <a id="req-lc-1-jt5pkt.t1.p5"></a>`REQ-LC-1-JT5PKT.T1.P5` — storage, code, balance and transaction count of a contract and of an account; <a id="req-lc-1-jt5pkt.t1.p6"></a>`REQ-LC-1-JT5PKT.T1.P6` — a read after each of two transactions that overwrite one slot; <a id="req-lc-1-jt5pkt.t1.p7"></a>`REQ-LC-1-JT5PKT.T1.P7` — reads after a call that writes; <a id="req-lc-1-jt5pkt.t1.p8"></a>`REQ-LC-1-JT5PKT.T1.P8` — five reads of two contracts made at once; <a id="req-lc-1-jt5pkt.t1.p9"></a>`REQ-LC-1-JT5PKT.T1.P9` — a call into one of Ethereum's precompiles, whose account is not proven                                                                                                                                                                                                                                                                   |
| <a id="req-lc-2-pmy1vg.t1"></a>`REQ-LC-2-PMY1VG.T1` | [`REQ-LC-2-PMY1VG`](light-client.md#req-lc-2-pmy1vg) | The same setup; make reads the light client does not answer.                                                                                                                                                                                                                                                                                                   | The endpoint answers each; nothing is logged as an error and no failure is counted.                                                      | <a id="req-lc-2-pmy1vg.t1.p1"></a>`REQ-LC-2-PMY1VG.T1.P1` — a call and a storage read at an earlier block, a pending transaction count and a call with a gas limit; <a id="req-lc-2-pmy1vg.t1.p2"></a>`REQ-LC-2-PMY1VG.T1.P2` — a call that reaches the chain's own precompile and a call that reads the previous block's hash, each counted as left to the endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| <a id="req-lc-3-w7rrhm.t1"></a>`REQ-LC-3-W7RRHM.T1` | [`REQ-LC-3-W7RRHM`](light-client.md#req-lc-3-w7rrhm) | The same setup; the proxy answers one request of a proven read in the node's place.                                                                                                                                                                                                                                                                            | The read gives the node's answer, one error is logged and one failure counted per failed read, and the next read is proven again.        | <a id="req-lc-3-w7rrhm.t1.p1"></a>`REQ-LC-3-W7RRHM.T1.P1` — an empty proof for a storage read and for a call's block values, logged as a refused proof; <a id="req-lc-3-w7rrhm.t1.p2"></a>`REQ-LC-3-W7RRHM.T1.P2` — the best block request rejected, logged as another failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| <a id="req-lc-4-e29y46.t1"></a>`REQ-LC-4-E29Y46.T1` | [`REQ-LC-4-E29Y46`](light-client.md#req-lc-4-e29y46) | Build the SDK's chain access with and without the light client switched on, over an endpoint with and without the light client endpoints.                                                                                                                                                                                                                      | Off, it is the plain chain access; on without the endpoints, every read goes to the endpoint with one error logged.                      | <a id="req-lc-4-e29y46.t1.p1"></a>`REQ-LC-4-E29Y46.T1.P1` — switched on over a node that does not list the endpoints: two reads answered by the node, counted, one error, the methods asked once and no best block asked; <a id="req-lc-4-e29y46.t1.p2"></a>`REQ-LC-4-E29Y46.T1.P2` — not switched on over an endpoint that lists them: a read goes to the endpoint and the methods are not asked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| <a id="req-lc-5-mm0bm9.t1"></a>`REQ-LC-5-MM0BM9.T1` | [`REQ-LC-5-MM0BM9`](light-client.md#req-lc-5-mm0bm9) | The setup of [`REQ-LC-1-JT5PKT.T1`](light-client.md#req-lc-1-jt5pkt.t1) with a contract that logs the slot a transaction stores at; the participant follows one slot as the channel. The proxy names an earlier block of the node as its best one, so that a read is made at a block whose pushed block has arrived, and can change or drop the pushed blocks. | Each read gives the node's own answer for the read's block; the proxy shows which slots were proven and which subscriptions were made.   | <a id="req-lc-5-mm0bm9.t1.p1"></a>`REQ-LC-5-MM0BM9.T1.P1` — a storage read at a later block after a pushed write, answered without a proof; <a id="req-lc-5-mm0bm9.t1.p2"></a>`REQ-LC-5-MM0BM9.T1.P2` — a contract call over the pushed storage, with no slot proven; <a id="req-lc-5-mm0bm9.t1.p3"></a>`REQ-LC-5-MM0BM9.T1.P3` — a slot a pushed block wrote that no read held, proven when read; <a id="req-lc-5-mm0bm9.t1.p4"></a>`REQ-LC-5-MM0BM9.T1.P4` — the followed contract's balance after a paying transaction, proven at the read's block; <a id="req-lc-5-mm0bm9.t1.p5"></a>`REQ-LC-5-MM0BM9.T1.P5` — the pushed blocks dropped on the way: two held slots proven in one request; <a id="req-lc-5-mm0bm9.t1.p6"></a>`REQ-LC-5-MM0BM9.T1.P6` — the channel unfollowed: the subscription ended and the slot proven as any other; <a id="req-lc-5-mm0bm9.t1.p7"></a>`REQ-LC-5-MM0BM9.T1.P7` — a second channel of the contract followed: one subscription with both topics in place of the first, and the second channel's write answered without a proof; <a id="req-lc-5-mm0bm9.t1.p8"></a>`REQ-LC-5-MM0BM9.T1.P8` — the connection cut over a block and restored: subscribed again and the held slot proven again; <a id="req-lc-5-mm0bm9.t1.p9"></a>`REQ-LC-5-MM0BM9.T1.P9` — an endpoint without the light client endpoints: no subscription |
| <a id="req-lc-6-nefa2n.t1"></a>`REQ-LC-6-NEFA2N.T1` | [`REQ-LC-6-NEFA2N`](light-client.md#req-lc-6-nefa2n) | The setup of [`REQ-LC-5-MM0BM9.T1`](light-client.md#req-lc-5-mm0bm9.t1) with an interval of five blocks; a transaction writes a held slot and logs another topic than the followed one.                                                                                                                                                                        | The slot is answered as held until the interval is over, then proven, counted and warned about.                                          | <a id="req-lc-6-nefa2n.t1.p1"></a>`REQ-LC-6-NEFA2N.T1.P1` — a read four blocks after the last whole proof answers the held value without a proof, and a read five blocks after it proves the slot, answers the node's value, counts one changed slot and logs one warning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| <a id="req-lc-6-nefa2n.t2"></a>`REQ-LC-6-NEFA2N.T2` | [`REQ-LC-6-NEFA2N`](light-client.md#req-lc-6-nefa2n) | Build the SDK's chain access with the light client on and an interval, over an address nothing listens on.                                                                                                                                                                                                                                                     | An invalid interval is refused by name; a valid one goes on to the endpoint.                                                             | <a id="req-lc-6-nefa2n.t2.p1"></a>`REQ-LC-6-NEFA2N.T2.P1` — zero blocks; <a id="req-lc-6-nefa2n.t2.p2"></a>`REQ-LC-6-NEFA2N.T2.P2` — two and a half blocks; <a id="req-lc-6-nefa2n.t2.p3"></a>`REQ-LC-6-NEFA2N.T2.P3` — one block, accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| <a id="req-lc-7-w8wdn3.t1"></a>`REQ-LC-7-W8WDN3.T1` | [`REQ-LC-7-W8WDN3`](light-client.md#req-lc-7-w8wdn3) | The setup of [`REQ-LC-5-MM0BM9.T1`](light-client.md#req-lc-5-mm0bm9.t1); the proxy changes the pushed block of a transaction's block.                                                                                                                                                                                                                          | The read gives the node's answer from a proof of its own; one refused block is counted, one error logged, and no read counted as failed. | <a id="req-lc-7-w8wdn3.t1.p1"></a>`REQ-LC-7-W8WDN3.T1.P1` — the pushed value replaced by another; <a id="req-lc-7-w8wdn3.t1.p2"></a>`REQ-LC-7-W8WDN3.T1.P2` — the proof left out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| <a id="req-lc-8-bbyc51.t1"></a>`REQ-LC-8-BBYC51.T1` | [`REQ-LC-8-BBYC51`](light-client.md#req-lc-8-bbyc51) | Run a participant with the light client on over a chain node with the light client endpoints and the channel contract deployed; a proxy records what the endpoint was asked.                                                                                                                                                                                   | The endpoint is asked for one subscription of the channel contract with the channel's id as topic, and for its end.                      | <a id="req-lc-8-bbyc51.t1.p1"></a>`REQ-LC-8-BBYC51.T1.P1` — the participant selects a channel; <a id="req-lc-8-bbyc51.t1.p2"></a>`REQ-LC-8-BBYC51.T1.P2` — it clears the selection; <a id="req-lc-8-bbyc51.t1.p3"></a>`REQ-LC-8-BBYC51.T1.P3` — it is disposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Future Work

_Non-normative._ Proving the held storage again while the channel has an open dispute and before a
step that moves money, next to the interval. Carrying the block values and the contract's account in
the pushed block, so that a call at a new block needs no request. Reading through the light client
before the first block arrives. Comparing the best block with a second endpoint. Chains other than
peer3, and endpoints with another proof representation.
