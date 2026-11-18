# Contract Storage Proven Against a State Root

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

A participant can hold contract storage it did not read through a trusted call: an RPC endpoint hands
it slot values together with a proof. Before the participant relies on such a value, it checks the
proof against a state root it already trusts. The check has three outcomes for a slot: the root
commits to a value, the root commits to the slot holding nothing, or the proof does not decide. Only
the first two give the participant a value. Chains prove storage in different representations, so the
check sits behind one interface with one verifier per representation.

## Requirements and invariants

**<a id="req-stproof-1-j20p5y"></a>`REQ-STPROOF-1-J20P5Y` — A slot value is accepted only when the proof decides it.** Given a
state root, a contract address, a list of slots and a proof, the verifier MUST return, for every
slot and in the order asked, the 32-byte value the state root commits to. A slot the state root
commits to hold nothing reads as zero. When the proof does not decide every asked slot, the verifier
MUST fail and return no value for any of them. A proof does not decide a slot when a node on the
slot's path is absent from the proof, when the content of a node does not hash to the reference that
leads to it, when the state root is not the hash of a node of the proof, when a node on the path is
malformed, or when the committed value is not 32 bytes long. A slot the proof does not decide MUST
NOT read as empty. Nodes of the proof that lie on no asked slot's path are ignored.

**<a id="req-stproof-2-abcqr7"></a>`REQ-STPROOF-2-ABCQR7` — One verifier per proof representation.** Every verifier MUST meet
[`REQ-STPROOF-1-J20P5Y`](storage-proofs.md#req-stproof-1-j20p5y) through the same interface, so that
the caller does not depend on the representation. The first representation is the Substrate read
proof of a Frontier chain: contract storage is the EVM pallet's storage map keyed by address and
slot inside the chain's Blake2-256 state trie, and the state root is the one in the Substrate block
header. Its verifier MUST derive the slot's trie key the way the chain does, so that a proven value
equals what the chain's own storage read returns at that block. It MUST read a value the trie holds
by hash (state version 1) through the proof node that carries the value, and MUST read the nodes of
both state versions. It MUST refuse an address that is not 20 bytes and a slot that is not 32 bytes
before reading the proof, as either would derive the key of another entry.

**<a id="req-stproof-3-nvjgr0"></a>`REQ-STPROOF-3-NVJGR0` — A pushed block is accepted only under its own header.** An endpoint
can push, for one contract and one block, the block header, the contract slots written in the block, a
proof of those slots and the contract logs of the block. The participant MUST take the state root from
that header and accept the writes only when every pushed value is the value [`REQ-STPROOF-1-J20P5Y`](storage-proofs.md#req-stproof-1-j20p5y)
proves under it; a slot pushed as cleared MUST prove to hold nothing. It MUST identify the block by the
hash of the header and by the Ethereum block hash the chain wrote into the header. It MUST reject the
block when the header carries no such hash or more than one, and when a pushed log names another
Ethereum block. A block with logs and no write is accepted without a proof. A rejected block yields no
write.

## Assumptions and constraints

- A pushed header is taken as the chain's. The check binds the writes, the logs and the proof to that one
  header; it does not bind the header to the chain.
- The caller supplies a state root it trusts. The verifier establishes no trust in the root and does
  not fetch it.
- A proof speaks for one state root. It says nothing about the slot at another block, and nothing
  about slots that were not asked.
- The verifier checks values, not completeness: whether the participant was given every slot that
  changed is outside this document.
- The hash function of the representation is collision resistant.
- The work of one check is bounded by the size of the proof and the length of the keys: every node
  is hashed once and a path visits at most one node per key nibble.

## Security considerations

Assets: the contract storage a participant holds locally and decides from. Trust boundary: the
proof and the values come from an RPC endpoint and are untrusted; only the state root is trusted.
Threats and defenses: an endpoint that sends a wrong value cannot produce nodes that hash up to the
root; an endpoint that withholds a node to make a stored slot look empty is refused, because an
undecided slot never reads as empty; malformed or truncated nodes are refused and cannot make the
check run without bound; a value of another length is refused, so no shorter or longer value is
padded or cut into a slot. A slot or address of the wrong length is refused before the proof is read,
because it would silently prove another entry. Residual risks: a state root taken from the same
endpoint as the proof makes the check catch faults and omissions of that endpoint but not a
consistent lie, and an endpoint can still withhold slots that changed.

## Verification and test plan

### Requirement test matrix

| Plan item                                                     | Requirements / invariants                                        | Setup and stimulus                                                                                                                                       | Expected result                                                                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="req-stproof-1-j20p5y.t1"></a>`REQ-STPROOF-1-J20P5Y.T1` | [`REQ-STPROOF-1-J20P5Y`](storage-proofs.md#req-stproof-1-j20p5y) | Check real proofs of a contract's slots, read from a chain together with the state root and the chain's own storage reads at that block.                 | Each slot reads as the chain's own value; a slot the chain stores nothing for reads as zero.                   | <a id="req-stproof-1-j20p5y.t1.p1"></a>`REQ-STPROOF-1-J20P5Y.T1.P1` — a stored slot; <a id="req-stproof-1-j20p5y.t1.p2"></a>`REQ-STPROOF-1-J20P5Y.T1.P2` — a slot the state holds nothing for; <a id="req-stproof-1-j20p5y.t1.p3"></a>`REQ-STPROOF-1-J20P5Y.T1.P3` — several slots from one proof, in the order asked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| <a id="req-stproof-1-j20p5y.t2"></a>`REQ-STPROOF-1-J20P5Y.T2` | [`REQ-STPROOF-1-J20P5Y`](storage-proofs.md#req-stproof-1-j20p5y) | Check a real proof that does not decide the asked slot, and proofs with crafted nodes.                                                                   | The check fails; no slot reads as empty or as any value.                                                       | <a id="req-stproof-1-j20p5y.t2.p1"></a>`REQ-STPROOF-1-J20P5Y.T2.P1` — a proof built for another slot; <a id="req-stproof-1-j20p5y.t2.p2"></a>`REQ-STPROOF-1-J20P5Y.T2.P2` — one of several asked slots not decided; <a id="req-stproof-1-j20p5y.t2.p3"></a>`REQ-STPROOF-1-J20P5Y.T2.P3` — each node of the path left out in turn; <a id="req-stproof-1-j20p5y.t2.p4"></a>`REQ-STPROOF-1-J20P5Y.T2.P4` — each node of the path changed in turn; <a id="req-stproof-1-j20p5y.t2.p5"></a>`REQ-STPROOF-1-J20P5Y.T2.P5` — a state root the proof does not lead to; <a id="req-stproof-1-j20p5y.t2.p6"></a>`REQ-STPROOF-1-J20P5Y.T2.P6` — a committed value that is not 32 bytes, with the same trie accepted at 32 bytes; <a id="req-stproof-1-j20p5y.t2.p7"></a>`REQ-STPROOF-1-J20P5Y.T2.P7` — a node of no known kind; <a id="req-stproof-1-j20p5y.t2.p8"></a>`REQ-STPROOF-1-J20P5Y.T2.P8` — a node shorter than the content it announces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| <a id="req-stproof-2-abcqr7.t1"></a>`REQ-STPROOF-2-ABCQR7.T1` | [`REQ-STPROOF-2-ABCQR7`](storage-proofs.md#req-stproof-2-abcqr7) | Check Substrate read proofs of a Frontier chain with a state version 1 trie; ask with an address and a slot of the wrong length.                         | The proven value equals the chain's own storage read; a value held by hash is read; wrong lengths are refused. | <a id="req-stproof-2-abcqr7.t1.p1"></a>`REQ-STPROOF-2-ABCQR7.T1.P1` — the proven slot value equals the chain's own storage read at that block; <a id="req-stproof-2-abcqr7.t1.p2"></a>`REQ-STPROOF-2-ABCQR7.T1.P2` — a value the trie holds by hash; <a id="req-stproof-2-abcqr7.t1.p3"></a>`REQ-STPROOF-2-ABCQR7.T1.P3` — an address that is not 20 bytes; <a id="req-stproof-2-abcqr7.t1.p4"></a>`REQ-STPROOF-2-ABCQR7.T1.P4` — a slot that is not 32 bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| <a id="req-stproof-3-nvjgr0.t1"></a>`REQ-STPROOF-3-NVJGR0.T1` | [`REQ-STPROOF-3-NVJGR0`](storage-proofs.md#req-stproof-3-nvjgr0) | Check blocks a real chain pushed, with the block hash and the Ethereum block hash the chain reports for them, and the same blocks with one part changed. | A real block yields its writes and identities; every changed block is rejected.                                | <a id="req-stproof-3-nvjgr0.t1.p1"></a>`REQ-STPROOF-3-NVJGR0.T1.P1` — the write of a pushed block; <a id="req-stproof-3-nvjgr0.t1.p2"></a>`REQ-STPROOF-3-NVJGR0.T1.P2` — every write of a block, also of a slot no pushed log names; <a id="req-stproof-3-nvjgr0.t1.p3"></a>`REQ-STPROOF-3-NVJGR0.T1.P3` — a slot pushed as cleared; <a id="req-stproof-3-nvjgr0.t1.p4"></a>`REQ-STPROOF-3-NVJGR0.T1.P4` — logs and no write; <a id="req-stproof-3-nvjgr0.t1.p5"></a>`REQ-STPROOF-3-NVJGR0.T1.P5` — a pushed value that differs from the proven one; <a id="req-stproof-3-nvjgr0.t1.p6"></a>`REQ-STPROOF-3-NVJGR0.T1.P6` — a stored slot pushed as cleared; <a id="req-stproof-3-nvjgr0.t1.p7"></a>`REQ-STPROOF-3-NVJGR0.T1.P7` — a cleared slot pushed with a value; <a id="req-stproof-3-nvjgr0.t1.p8"></a>`REQ-STPROOF-3-NVJGR0.T1.P8` — the proof left out; <a id="req-stproof-3-nvjgr0.t1.p9"></a>`REQ-STPROOF-3-NVJGR0.T1.P9` — the header of another block; <a id="req-stproof-3-nvjgr0.t1.p10"></a>`REQ-STPROOF-3-NVJGR0.T1.P10` — the proof of another block; <a id="req-stproof-3-nvjgr0.t1.p11"></a>`REQ-STPROOF-3-NVJGR0.T1.P11` — a log of another Ethereum block; <a id="req-stproof-3-nvjgr0.t1.p12"></a>`REQ-STPROOF-3-NVJGR0.T1.P12` — a header without the Ethereum block hash; <a id="req-stproof-3-nvjgr0.t1.p13"></a>`REQ-STPROOF-3-NVJGR0.T1.P13` — a header with two Ethereum block hashes; <a id="req-stproof-3-nvjgr0.t1.p14"></a>`REQ-STPROOF-3-NVJGR0.T1.P14` — the header hash equals the block hash the chain reports; <a id="req-stproof-3-nvjgr0.t1.p15"></a>`REQ-STPROOF-3-NVJGR0.T1.P15` — the Ethereum block hash read from the header equals the one the chain reports |

## Future Work

_Non-normative._ Further representations, such as the Merkle-Patricia account and storage proofs of
an Ethereum chain. Proofs of a contract's code and of an account's balance and nonce. How the
participant obtains the state root, how it learns that a slot changed, and what it does when a
check fails are separate subjects.
