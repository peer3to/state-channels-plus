# SignatureCollectionMap.ts

> **Source:** [src/utils/SignatureCollectionMap.ts](../../../../../../src/utils/SignatureCollectionMap.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-ID-1-3Q2KB9` (Recoverable signatures over canonical targets)](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9)

## UNIT-TEST-SIGNATURE-COLLECTION-MAP-32-KB4QYC

Signature projection

- Setup: Use real signed values across multiple keys; compare fresh ordered arrays and live iteration after callback mutation.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-SIGNATURE-COLLECTION-MAP-32-KB4QYC.P1` — projects ordered signatures into fresh arrays and preserves live callback iteration
