# DisputeAuditOlderDispute.test.ts

Test file: [test/unit/DisputeAuditOlderDispute.test.ts](../../../../../../test/unit/DisputeAuditOlderDispute.test.ts)

## Overview

Audits older disputes against newer final evidence. Cases check availability precedence, below-anchor and final-state counters, timeout supersession, and response with newer evidence when the older application state is absent.

## Tests

- `U38: auditing data omitted while a participant's signature is missing -> DisputeLastMilestoneNotFinalAndNoAuditingData, the audit stops before the walk and every later check`: REQ-FP-7-4DD0D7.T6.P1, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P39
- `U38: auditing data omitted while a pending participant's signature is missing -> DisputeLastMilestoneNotFinalAndNoAuditingData, the audit stops before the walk and every later check`: REQ-FP-7-4DD0D7.T6.P2, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P40
- `U39: required auditing data posted, wrong dispute output -> the audit proceeds past the proof to DisputeInvalidOutputState`: REQ-FP-7-4DD0D7.T6.P3, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P41
- `U89: a stale omitted-data dispute below the same-fork anchor, audited after pruning the obsolete blocks, snapshots and states below the anchor -> DisputeStateProofBelowOnChainAnchor before any walk`: REQ-FP-7-4DD0D7.T6.P4, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P42
- `U89: the same stale dispute with posted auditing data, the obsolete snapshots and states pruned too -> DisputeStateProofBelowOnChainAnchor before any walk`: REQ-FP-7-4DD0D7.T6.P5, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P43
- `U94: the disputer signed a newer block than its dispute's latest state, which the auditor never held -> DisputeNotLatestState from that signature, no backward replay`: REQ-FP-7-4DD0D7.T6.P6, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P44
- `U41: an auditor missing older application states but holding a newer finalized state audits a current dispute -> no missing-state failure, true`: REQ-SP-9-RNXP56.T5.P1, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P45
- `U121: a departed, still chain-eligible participant disputes its last signed state; a late-synced pending auditor without that state -> no invented counter, no fatal error, true, and its own dispute is newer`: REQ-SP-9-RNXP56.T5.P2, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P46
- `U113: a pending disputer's state that the late pending auditor never held -> no backward replay, no newer-signature counter, no balance read of that state, no fatal error; the auditor's own newer dispute lands on chain`: REQ-SP-9-RNXP56.T5.P3, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P47
- `U114: the auditor's newer submission lacks the pending disputer's signature and holds no anchor -> its auditing data is posted and it still lands on chain`: REQ-SP-9-RNXP56.T5.P4, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P48
- `U121: a departed, still chain-eligible participant's last signed state that the late pending auditor never held -> no balance read of that state, no counter; the auditor's own newer dispute lands on chain`: REQ-SP-9-RNXP56.T5.P5, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P49
- `colluders fork right after the chain anchor and a pending joiner without the anchor state audits the omitted-data dispute -> it stores DisputeConflictsWithFinalState at a height of its own final history before any walk, does not throw, and the chain accepts it`: REQ-FP-7-4DD0D7.T6.P7, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P50
- `U125: a departed, still chain-eligible participant times out the honest next author of its last signed state -> TimeoutThreshold from that block's direct signatures without the departed signer, and the kill slashes it`: REQ-FP-7-4DD0D7.T6.P8, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P51
- `a departed participant's false timeout of a peer that did not author the next height, audited by a late pending auditor with a later final state but without the departed state or calldata there -> false + exactly TimeoutSupersededByFinalState, which the chain accepts`: REQ-FP-7-4DD0D7.T6.P9, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P52
- `control: a departed participant's honest timeout of the next author who produced nothing, audited by a participant whose final state is below the timeout height -> true, no TimeoutSupersededByFinalState`: REQ-FP-7-4DD0D7.T6.P10, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P53
- `the late auditor holds a fully signed block at the timeout height by another author than the accused, and the latest state's snapshot -> no TimeoutThreshold from that block; TimeoutSupersededByFinalState instead`: REQ-FP-7-4DD0D7.T6.P11, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P54
- `U99, U122: posted auditing data, a hop consumes the joiner's JOIN but leaves the joiner out of its snapshot and signatures -> false + DisputeInvalidStateProof pointed at that hop, which the chain accepts`: REQ-FP-7-4DD0D7.T6.P12, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P55
- `U99, U122: the joiner itself audits, without the hop's preceding state: posted auditing data, the hop consumes its JOIN but leaves it out of the snapshot and signatures -> false + DisputeInvalidStateProof the chain accepts, no throw, and it never acquires that state`: REQ-FP-7-4DD0D7.T6.P13, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P56
- `U99, U122 control: the honest hop seats the joiner it consumes -> no counter, true`: REQ-SP-9-RNXP56.T5.P6, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P57
