# BlockCommitService.ts — Source Report

> **Source:** [src/stateManager/block/BlockCommitService.ts](../../../../../../../src/stateManager/block/BlockCommitService.ts) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Owns later cooperative promotion of a receipt-confirmed `PENDING_PARTICIPANT` to `PARTICIPATING`. This is
separate from the earlier targeted-connect Boolean membership boundary and does not roll back the successful
receipt when later inclusion is delayed.

## Linked requirements

| Source file                                                                                | Specification IDs                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [BlockCommitService.ts](../../../../../../../src/stateManager/block/BlockCommitService.ts) | [`REQ-TJOIN-3-DCZKS6`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6), [`REQ-TJOIN-5-Q795M7`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7) |

## Component test obligations

| Unit test ID                                                                                  | Obligation                  | Public entry and setup                                                  | Oracle and forbidden effects                                                                                   | Required permutations                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-block-commit-service-1-v6tp9s"></a>`UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S` | Later cooperative inclusion | Commit the first block that includes a receipt-confirmed pending joiner | Status advances to participating and force-join bookkeeping clears without changing the earlier connect result | <a id="unit-test-block-commit-service-1-v6tp9s.p1"></a>`UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P1` — pending joiner included by first committed block |

## Verification

Block-commit tests cover cooperative pending-to-participating promotion; forced-inclusion evidence remains
owned by the dispute suite.
