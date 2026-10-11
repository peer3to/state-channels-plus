# DisputeBuilder.test.ts

Test file: [test/unit/DisputeBuilder.test.ts](../../../../../../test/unit/DisputeBuilder.test.ts)
Exercises: [DisputeBuilder.ts](../../../../implementation/source/src/disputeManager/DisputeBuilder.ts.md)

## Overview

The suite drives the builder through `DisputeManager.constructDispute` on a running in-process
channel, host-side (`execOnHost`) or through the harness `dispute.constructDispute` endpoint, and
calls `reconstructAuditingData` on the peer's own builder. Every changed input reaches the builder
through its real owner: a block authored by the participants (`advanceState`), the public
`leaveChannel` that starts the exit and sets the force-exit flag, the participant timeout service
storing a timeout once the silent writer's real deadline passed, and the validation pipeline storing
an invalid-transition fraud proof.

The reuse case constructs twice with nothing changed and asserts the same result object (a build
returns new objects). Each changed-input case constructs once, changes one input, constructs again
and asserts the changed field against the first result: the later block's snapshot height and a
proof the chain accepts (`chainAcceptsDisputeProof`), `selfRemoval` on an unchanged latest state, a
timeout naming the writer at the next height that an honest auditor (`runDisputeValidation`) accepts
with no dispute fraud proof, and the applied fraud proof with its slash. The timeout case holds the
timeout service's build (`holdTimeoutBuild`) so the first construction cannot see the timeout, waits
until the real deadline reaches that build, then releases it; only peer 0 times the writer out.

The restart case holds construction at its state-proof build (`holdConstructDisputeAtStateProof`)
after it read height 1, commits block 2, releases, and asserts the returned dispute's auditing data
is at height 2 and the chain accepts its proof, so inputs and proof come from the same later read.
The reconstruction case names a snapshot hash absent from storage and asserts the exact rejection and
no auditing data.

Extra signatures on the unchanged latest block are not a changed input. The signature case stages a
writer whose stored latest block lacks one participant's signature (one non-writer's broadcast is
suppressed while the block is authored; no peer runs the timeout check). It constructs once, merges
the silenced peer's signature through the stored-block merge with the live validation strategy, and
constructs again. The second construction returns the cached result object, the latest height is
unchanged, the evidence comparison against the dispute built before the signature finds no added
evidence before and after, and the chain still accepts the reused dispute's proof.

A cached omission is checked against the chain before reuse. The omission case stages
`stageMirrorMissingJoin` for peer 0 (the chain holds a join the head milestone waits on; peer 0's
mirror missed it) and serves peer 0's chain `isAuditingDataOmissionAllowed` reads from the block
before that join (`serveChainReadsBefore`), so the first construction leaves the data out. It then
restores the chain view, which moves the chain answer to "not allowed" while peer 0's inputs stay
unchanged, and constructs twice more. The second construction is a new result with the same
fingerprint that posts its auditing data; the third returns that result. The observed chain answers
are exactly the re-check and the build's confirmation (`[false, false]`) with one local answer: the
posted dispute is reused with no chain read.

The reduction case constructs on peer 1, lets peer 0 leave through a self-removal dispute, waits for
peer 1's `onDisputeReducedResultCommitted`, and asserts peer 1 keeps no built dispute for the fork.

## Tests

- `unchanged inputs → the second construction returns the cached result`: UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P3
- `a valid signature merged into the unchanged latest block after a cached construction → the cached result is returned and adds no evidence`: UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P1, REQ-DISPUTE-PIPE-6-6FZB9M.T1.P14
- `a newer latest block after a cached construction → the next dispute proves the later block`: UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P4
- `an exit started after a cached construction → the next dispute carries the self-removal`: UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P5, UNIT-TEST-DISPUTE-MANAGER-2-FB6G5R.P3
- `a real timeout becoming eligible after a cached construction → the next dispute claims it and an honest auditor accepts it`: UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P6
- `real fraud evidence stored after a cached construction → the next dispute applies its proof and lists the slash`: UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P7
- `a cached dispute that omits its auditing data, then the chain no longer allows the omission → the next construction builds again and posts the data`: UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P10
- `the fork's reduced result committed after a cached construction → the built dispute is dropped`: UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P11
- `a newer block committed while construction is held at its state proof → the dispute proves the later block throughout`: UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P2, REQ-DISPUTE-PIPE-6-6FZB9M.T1.P15
- `a dispute naming a snapshot absent from storage → rejects naming that snapshot, no auditing data`: UNIT-TEST-DISPUTE-BUILDER-1-HZMQMN.P9
