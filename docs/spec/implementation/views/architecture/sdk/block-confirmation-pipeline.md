# Block-Confirmation Pipeline

> **Specification subject:** [Block Intake, Validation, and Commitment Pipeline](../../../../specification/block-progression/block-processing.md)

## INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H

Source checks across actual RPC and normal processing

- Setup: Eligible/unknown peers, real sync responses, held execution, actual membership changes.
- Oracle: Exact accepted source counts, retained values, progress, supplier consequence and cleanup in each variation.

- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P3` — a real slash rejects the next supplier copy without changing held honest work
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P6` — one supplier's nonce-variant signatures cannot spend another participant's allowance and blacklist it as a double signer
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P7` — observed slash removes cached eligibility before the next stored network copy
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P8` — an authoritative slash refresh discards a cache-miss copy without sync
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P9` — a pending join cache miss refreshes from chain before stored-copy admission without sync
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P10` — a delivered pending join event admits the first network copy without another read
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P15` — stored block survives malformed confirmations from one eligible network supplier
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P16` — malformed required signed evidence reaches objective dispute verification and kills its committed dispute without a synthetic network source
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P17` — ingest rejects a block confirmation with a forged author signature
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P18` — ingest cuts both an eligible relayer and the author of an outsider-authored block
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P19` — unknown fork: both the supplier and the author are asked and both are cut
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P20` — still recovers via local reduction when the raced block is on yet another unknown fork
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P21` — cuts both an eligible relayer and the outsider author while the victim keeps spectating
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P22` — each stored network copy of nonce-variant signatures is bounded before its ordinary merge and blacklists its source as a double signer; processing has no shared source allowance
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P23` — junk from one queued source cannot crowd out honest signatures; ordinary validation punishes only the bad supplier and completes the block
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P24` — an existing sync handles an unknown-source copy without another wire request
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P25` — failed ingress sync blacklists its sender without queueing the triggering block
- [x] `INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P26` — successful ingress sync ends the request without queueing the triggering copy
