# LocalP2pSigner.ts

> **Source:** [src/evm/signer/LocalP2pSigner.ts](../../../../../../../src/evm/signer/LocalP2pSigner.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/architecture.md](../../../../views/architecture/sdk/architecture.md)

## Requirements

- [`REQ-ID-3-KR0BE3` (Confined signing authority)](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)
- [`REQ-TJOIN-6-0HEVYH` (Single-channel runtime ownership)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh)
- [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay)
- [`INV-TJOIN-1-R3K75D` (Exact target ownership)](../../../../../specification/peer-communication/targeted-channel-join.md#inv-tjoin-1-r3k75d)
- [`REQ-TJOIN-2-MFWADG` (Separated matching and handoff)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-2-mfwadg)
- [`REQ-TJOIN-1-5VGR1F` (Independent public options)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f)
- [`REQ-TJOIN-3-DCZKS6` (Verified synchronization and membership)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6)
- [`REQ-TJOIN-4-SDPZJW` (Direct response routing)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-4-sdpzjw)
- [`REQ-TJOIN-5-Q795M7` (Phase-specific failure)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7)

## UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW

Targeted connect composition

- Setup: Call the public signer through unopened, matched, opened, synced, pending, and participating states
- Oracle: The signer sequentially delegates each phase and returns the final owner result without retaining an attempt object

- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P1` — unopened false
- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P2` — targeted opening
- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P3` — observer sync
- [ ] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P4` — pending reuse
- [ ] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P5` — participating reuse
