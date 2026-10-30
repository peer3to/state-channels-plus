# EventHandlerEvidence.test.ts

Test file: [EventHandlerEvidence.test.ts](../../../../../../test/unit/EventHandlerEvidence.test.ts)
Exercises: [DisputeManager.ts.md](../../../../implementation/source/src/disputeManager/DisputeManager.ts.md)

## Overview

Each case runs real audits of real committed disputes on a four-peer math channel; the race and
sequential cases stage one invalid state transition. After a valid audit, `EventHandler` asks
`DisputeManager.shouldAddOwnEvidence`, which owns the once-per-fork evidence comparison. The
auditing peer's own dispute initiation is suppressed, so it only audits. A record-only probe
(`recordEvidenceComparisons`, backed by the node-only `EvidenceComparisonRecorder` under
`test/fixtures/customRpc/harnessControl/services/stub/node/`) wraps `shouldAddOwnEvidence` (the
audits, with their answers) and the `constructDispute` calls made inside it (the comparisons, with
their outcome: `pending`, `resolved`, or `rejected`, the error name, and the built dispute's hash),
and counts the other `constructDispute` calls (the builds of `dispute`). Every call is forwarded.
The probe can apply one fault to the next comparison: `comparisonError` rejects it,
`unrecoverableInboundRun` makes the real `constructDispute` find its inbound run unrecoverable, so
the error propagates rather than becoming a no-evidence answer, `hold` parks it until the test releases it to run for
real (`forward`) or to reject (`fail`), and `holdBuilt` parks it after its real construction until
the test releases it to return that construction or to reject. `repeatLastAudit` asks `shouldAddOwnEvidence` again with the
last audit's fork and dispute. The oracles are the recorded comparisons and audits per peer, the
auditor's `onDisputeCommitted` count (audits that completed), the auditor's recorded uploads, the
committed dispute a peer observes, and the expected detached errors.

The race case lets two disputers upload concurrently: each disputer audits the other's dispute and
records no comparison, and the auditor records one comparison for two audits. The sequential cases
upload the second dispute only after the first comparison settled. The held race parks the
auditor's first comparison until both audits asked for it, so the second audit overlaps the first
for certain. The higher-state cases keep peer 2 away before block 0, so its view is the genesis,
and let it upload its genesis-state self-removal dispute; the auditor (peer 0) reached block 1, so
its own dispute adds evidence. In the upload-retry case the auditor's first upload fails once at
send and a second dispute lands after it. The reuse case holds the auditor's comparison after its
construction and releases it as is: the committed dispute has the compared dispute's hash and
`dispute` built nothing. There is no case for adding signatures to the unchanged latest block or
for a newer block arriving during a held build. The kill case keeps a positive comparison while the auditor's initiation is suppressed,
then a reasonless dispute makes the auditor kill it in its own multicall: `dispute` builds once and
lists the killed submitter's slash. The exiting case sets the auditor's force-exit flag before the
genesis dispute: the audit answers yes with no comparison and the committed dispute is a
self-removal, built once. The kill-replacement case holds the comparison against one dispute while
another participant kills the spam dispute of the same fork, lets a replacement comparison settle,
and only then fails the dropped one. The reduced-result case keeps the answer until the window's
`DisputeReducedResultCommitted`, then asks again.

## Tests

- `disputers never compare; a non-disputer compares once across two audits of the fork`: UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P1, UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P2, REQ-DISPUTE-PIPE-6-6FZB9M.T1.P7
- `a failed comparison is not kept: the next audit compares again`: UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P3
- `a comparison ended by missing own auditing data is not kept: the next audit compares again`: none
- `concurrent audits share one in-flight comparison: while the first is held the second audit starts no construction, and both get its answer`: UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P8
- `a positive comparison whose upload fails is kept: the next audit retries the upload without comparing again`: UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P4
- `a leaving node audits a valid dispute: it disputes at once with its self-removal, building its dispute once and comparing nothing`: UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P13
- `a counter-dispute uploads the dispute its comparison built, without building it again`: UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P10
- `a kill of another dispute follows a kept positive comparison: dispute(kill) builds its own dispute with the killed submitter's slash instead of the compared one`: UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P12
- `a comparison dropped by a kill cannot erase its replacement when it settles later`: UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P9
- `a committed reduced result drops the fork's kept comparison: asked again, the fork compares again`: UNIT-TEST-DISPUTE-MANAGER-7-Q63JZM.P7
