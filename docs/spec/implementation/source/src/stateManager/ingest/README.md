# src/stateManager/ingest — Subsystem

> **Status:** Authored — engineer verification pending.

## Contents

- [BlockQueueManager.ts](./BlockQueueManager.ts.md)
- [StoredBlockMergeService.ts](./StoredBlockMergeService.ts.md)
- [ValidationService.ts](./ValidationService.ts.md)

This subsystem owns queued block ingress and exact-peer block/fork recovery. Recovery remains separate from
initial channel-load synchronization.

## Admission and source accounting

BlockQueueManager checks sources at intake, awaits ordinary sync when required, and owns queue scheduling. QueueStorage owns
queued blocks and per-source contributions; ValidationService owns safe confirmation
normalization. BlockIngestService and StoredBlockMergeService both use the strategy deviation and preserve
valid remaining signatures. Proof and calldata origins never borrow a transport quota. Standalone proof input does not enter queue storage. Ordinary sync
remains in SpectateService ([`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df), [`REQ-QSTORE-2-VYWJAQ` (Independent source allowances)](../../../../../specification/storage/queue.md#req-qstore-2-vywjaq)).

## System integration test plan

| Integration test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| --- | --- | --- | --- | --- |
| <a id="integration-test-ingest-admission-1-ea0c8h"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H` | Source checks across actual RPC and normal processing | Eligible/unknown peers, real sync responses, held execution, actual membership changes. | Exact accepted source counts, retained values, progress, supplier consequence and cleanup in each variation. | <a id="integration-test-ingest-admission-1-ea0c8h.p3"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P3` — a real slash rejects the next supplier copy without changing held honest work; <a id="integration-test-ingest-admission-1-ea0c8h.p6"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P6` — one supplier's valid signature variants cannot spend another participant's allowance; <a id="integration-test-ingest-admission-1-ea0c8h.p7"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P7` — observed slash removes cached eligibility before the next stored network copy; <a id="integration-test-ingest-admission-1-ea0c8h.p8"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P8` — an authoritative slash refresh discards a cache-miss copy without sync; <a id="integration-test-ingest-admission-1-ea0c8h.p9"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P9` — a pending join cache miss refreshes from chain before stored-copy admission without sync; <a id="integration-test-ingest-admission-1-ea0c8h.p10"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P10` — a delivered pending join event admits the first network copy without another read; <a id="integration-test-ingest-admission-1-ea0c8h.p15"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P15` — stored block survives malformed confirmations from one eligible network supplier; <a id="integration-test-ingest-admission-1-ea0c8h.p16"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P16` — malformed required signed evidence reaches objective dispute verification and kills its committed dispute without a synthetic network source; <a id="integration-test-ingest-admission-1-ea0c8h.p17"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P17` — ingest rejects a block confirmation with a forged author signature; <a id="integration-test-ingest-admission-1-ea0c8h.p18"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P18` — ingest cuts both an eligible relayer and the author of an outsider-authored block; <a id="integration-test-ingest-admission-1-ea0c8h.p19"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P19` — unknown fork: both the supplier and the author are asked and both are cut; <a id="integration-test-ingest-admission-1-ea0c8h.p20"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P20` — still recovers via local reduction when the raced block is on yet another unknown fork; <a id="integration-test-ingest-admission-1-ea0c8h.p21"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P21` — cuts both an eligible relayer and the outsider author while the victim keeps spectating; <a id="integration-test-ingest-admission-1-ea0c8h.p22"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P22` — each stored network copy is bounded before its ordinary merge; processing has no shared source allowance; <a id="integration-test-ingest-admission-1-ea0c8h.p23"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P23` — junk from one queued source cannot crowd out honest signatures; ordinary validation punishes only the bad supplier and completes the block; <a id="integration-test-ingest-admission-1-ea0c8h.p24"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P24` — an existing sync handles an unknown-source copy without another wire request; <a id="integration-test-ingest-admission-1-ea0c8h.p25"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P25` — failed ingress sync blacklists its sender without queueing the triggering block; <a id="integration-test-ingest-admission-1-ea0c8h.p26"></a>`INTEGRATION-TEST-INGEST-ADMISSION-1-EA0C8H.P26` — successful ingress sync ends the request without queueing the triggering copy |

## Queue admission contributions

| Source report | Contribution | Requirements |
| --- | --- | --- |
| [BlockQueueManager.ts](BlockQueueManager.ts.md) | Intake checks the channel and canonical author authentication before source admission, stored merging or queueing. | [`REQ-GOSSIP-4-J5Z4DF`](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df) |
| [ValidationService.ts](ValidationService.ts.md) | Confirmation classification catches recovery failure per signature and returns recovered signers separately from unrecoverable values. | [`REQ-BLOCK-PIPE-3-WW2SB7`](../../../../../specification/block-progression/block-processing.md#req-block-pipe-3-ww2sb7) |
| [BlockIngestService.ts](BlockIngestService.ts.md) | Struct replay creates an explicit internal proof entry, preserving historical evidence and the supplied strategy without inventing a network source. | [`REQ-GOSSIP-4-J5Z4DF`](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df) |
| [StoredBlockMergeService.ts](StoredBlockMergeService.ts.md) | Stored network copies arrive after the same eligibility and per-source allowance checks as fresh queue copies. | [`REQ-QSTORE-2-VYWJAQ`](../../../../../specification/storage/queue.md#req-qstore-2-vywjaq) |
