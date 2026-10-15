# time.ts

> **Source:** [src/types/time.ts](../../../../../../src/types/time.ts)

## Requirements

- [`REQ-TIME-1-FM4651` (Chain time is authoritative)](../../../../specification/protocol-model/time.md#req-time-1-fm4651)
- [`REQ-TIME-3-MT1MMF` (Window values and skew bound are explicit configuration trade-offs)](../../../../specification/protocol-model/time.md#req-time-3-mt1mmf)
- [`REQ-TIME-6-HGWWY9` (evidenceTime covers an honest kill)](../../../../specification/protocol-model/time.md#req-time-6-hgwwy9)
  Partial: `minEvidenceTime` is enforced only by a deployment that passes the target block time ([`FIND-DISPUTE-5-MZPTTC`](../../../../audit/open-findings.md#find-dispute-5-mzpttc)).
