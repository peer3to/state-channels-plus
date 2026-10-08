# BlockIngestService.test.ts

Test file: [test/unit/BlockIngestService.test.ts](../../../../../../test/unit/BlockIngestService.test.ts)
Exercises: [BlockIngestService.ts](../../../../implementation/source/src/stateManager/ingest/BlockIngestService.ts.md)

## Overview

The suite drives the ingest boundary with real confirmations from a teleported session: stale-fork
recognition (current fork, zero hash, invented fork, the fork left behind by a dispute, non-current forks
known through a genesis snapshot or a held block), an already stored block confirmed twice, the on-chain
timestamp recorded on the stored block, a sourceless bad confirmation, carried inbound message runs that
advance or hold the store head, and the reject paths of the full pipeline. The mapped timestamp case waits
for the store to hold the timestamp instead of reading the block right after the confirmation returns:
the ingest reply lands before the store write, so an immediate read raced the recording. Oracles are the
queue storage, the stored block's timestamp, the peer cut set, and the harness hooks.

Two tests replay a dispute's state proof as the dispute audit does: the validation probe
(`runBlockConfirmationStructUnderDispute`) calls `onBlockConfirmationStruct` with a real
`DisputeValidationStrategy` for a constructed dispute at unfinalized index 0, with the replayed
block's bytes replaced by a hash that does not decode. When the dispute's own state-proof block is
also replaced, the canonical structure predicate finds it invalid: the probe returns
`{ accepted: false, threw: null }` and exactly one `DisputeInvalidBlockStructure` proof is stored.
When the state proof keeps its honest block, the predicate finds it valid: the probe returns
`{ accepted: true, threw: null }` and no proof is stored. Neither path throws, including the refusal
log over the undecodable bytes.

One test starts three peers with a 17M transition budget and gives one non-leader peer the EVM's
default call gas (`executorCallGasLimitByPeer`), below what that budget needs. The leader authors the
next block off the wire (`authorNextBlockOffWireWait`), and the full ingest runs on the limited peer
(`runBlockIngest`): it throws an error naming `ErrorInsufficientGasForStateTransition`, returns no
keep-connection answer, fires no `invalidStateTransitionDetected` hook, stores no fraud proof,
disputes no fork and disconnects nobody, and the peer's next writer and next block height are
unchanged. The same confirmation on a third peer commits: keep-connection `true`, no error, no fraud
proof, no hook, and the height advances by one.

## Tests

- `fresh signer validation reads the resulting participant union before persisting the snapshot`: UNIT-TEST-BLOCK-INGEST-1-JV64AS.P3
- `current fork, zero hash and an invented fork → all not stale`: none
- `the fork we left behind after a dispute → stale`: none
- `a non-current fork whose genesis snapshot we hold → stale`: none
- `a non-current fork we hold a block of → stale`: none
- `the same confirmation ingested twice → accepted, signatures unchanged`: UNIT-TEST-BLOCK-INGEST-1-JV64AS.P4
- `a confirmation carrying an on-chain timestamp → the stored block records it`: UNIT-TEST-BLOCK-INGEST-1-JV64AS.P2
- `stray signatures on a stored block → stripped and supplier cut`: none
- `a sourceless bad confirmation → rejected without cutting any peer`: none
- `an undecodable replayed block whose state-proof structure is valid → true, no proof, no throw`: UNIT-TEST-BLOCK-INGEST-1-JV64AS.P8
- `a block one peer's local EVM refuses to run throws out of its ingest with no fraud proof, no dispute and the VM restored, while another peer commits it`: UNIT-TEST-BLOCK-INGEST-1-JV64AS.P9, REQ-ENFSM-1-DKJCY2.T1.P13
- `a run linked to a held inbound block → the store head advances with the snapshot`: none
- `runs with no reachable ancestor → persisted, the head never moves above the gap`: none
- `a linked writer block with a wrong snapshot hash → invalid transition, VM turn restored`: none
- `a forged inbound message block → forged hook fires, block rejected`: UNIT-TEST-SPECTATINGVALIDATION-STRATEGY-1-CTD8AH.P28
- `a rejected block carrying a real inbound run → the run is not stored, the head stays put`: none
