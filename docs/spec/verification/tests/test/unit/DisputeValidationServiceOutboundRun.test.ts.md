# DisputeValidationServiceOutboundRun.test.ts

Test file: [test/unit/DisputeValidationServiceOutboundRun.test.ts](../../../../../../test/unit/DisputeValidationServiceOutboundRun.test.ts)
Exercises: [DisputeValidationService](../../../../implementation/source/src/stateManager/dispute/DisputeValidationService.ts.md)

## Overview

Real channel history from `stageOutboundAroundAnchor`: the chain anchor holds outbound block 1 and the latest
state outbound block 2, whose snapshot post is held. Each case takes the honest dispute of a remaining peer,
marks its data posted, edits the posted outbound run, recommits the auditing-data hash and audits it with the
other remaining peer through the host-side audit entry. A truncated run and a run with a forged message balance
each return false with exactly one stored `DisputeInvalidOutboundRun`, and the chain's
`isDisputeOutboundRunInvalid` accepts the stored proof. The honest case prepends the anchor's own block (read
from the chain's applied outbound events) as a run built at a lower anchor, and first deletes both blocks from
the auditor's store: the audit returns true, the anchor's block stays absent, and the auditor's stored range from
the anchor head to the latest head is the one block above the anchor, which the chain's
`verifyOutboundMessageBlocks` accepts from the anchor's snapshot data to the latest state's — the check a
snapshot advance from that anchor applies.

Two cases cover the counter check after the local verdict (a probe on the local run verification). In the
first, the posted run is empty, so it is invalid from the first exit's anchor; the probe holds the first
verdict, the held second snapshot post is released so the chain anchor moves to the second exit, and then
the verdict is released. The chain refuses the counter, the audit judges again from the new anchor and
returns true with no stored proof and no fraud proof count; the probe saw two calls. In the second, the
probe answers invalid for an honest run while the anchor stays put: the audit throws "the chain rejects
the invalid-outbound-run counter from the anchor it was judged on", stores nothing and the probe saw one
call.

## Tests

- `auditingData.outboundMessageBlocks = [] while the latest outbound head is above the chain anchor, committed by the dispute -> false + DisputeInvalidOutboundRun, which the chain accepts`: REQ-DIS-12-AXY60R.T1.P14
- `auditingData.outboundMessageBlocks[0].messages[0].balance.amount += 1, committed by the dispute -> false + DisputeInvalidOutboundRun, which the chain accepts`: REQ-DIS-12-AXY60R.T1.P15
- `the posted run also carries the chain anchor's own outbound block (built while the anchor was lower) and the auditor holds neither block -> true; only the block above the anchor is stored, and the stored anchor-to-latest range is the run the chain's snapshot update accepts`: REQ-DIS-12-AXY60R.T1.P16
- `the chain anchor advances to the second exit between the audit's anchor read and its counter check, and the posted run is the empty run built from that exit -> the chain refuses the counter, the audit judges again from the new anchor and returns true with no counter and nothing to store above it`: REQ-DIS-12-AXY60R.T1.P18
- `the local verdict calls the honest posted run invalid while the chain anchor stays put -> the chain refuses the counter from the anchor it was judged on: the audit throws, stores no counter, and does not judge again`: UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P133
