# disputes.ts

> **Source:** [src/types/disputes.ts](../../../../../../src/types/disputes.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-DATA-1-1KNRQS` (Decoders reject malformed, truncated, trailing, out-of-range, wrong-tag, and…)](../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs)
- [`REQ-DISPUTE-PIPE-9-TDWQPV` (Existing-window state contributions)](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv)

## UNIT-TEST-DISPUTE-INPUT-CODEC-1-CWJV98

Signed input encoding

- Setup: Encode and decode factory-built nested dispute confirmation; toggle the boolean after signing.
- Oracle: Both values round-trip and the signature binds the original value.

- [x] `UNIT-TEST-DISPUTE-INPUT-CODEC-1-CWJV98.P1` — signed nested encoding binds and round-trips the boolean
