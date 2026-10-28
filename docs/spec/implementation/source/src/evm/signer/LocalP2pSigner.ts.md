# LocalP2pSigner.ts

> **Source:** [src/evm/signer/LocalP2pSigner.ts](../../../../../../../src/evm/signer/LocalP2pSigner.ts)

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
- [`REQ-LOBBY-9-N894C0` (Bounded inactive ingress and cleanup)](../../../../../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0)
- [`REQ-SDK-ARCH-7-H64K87` (Open connections are observable)](../../../../../specification/runtime/sdk.md#req-sdk-arch-7-h64k87)
- [`REQ-JOINSIG-4-3NBKHK` (Full-channel join)](../../../../../specification/peer-communication/join-authorization.md#req-joinsig-4-3nbkhk)

## UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW

Targeted connect composition

- Setup: Call the public signer through unopened, matched, opened, synced, pending, and participating states
- Oracle: The signer sequentially delegates each phase and returns the final owner result without retaining an attempt object

- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P1` — unopened false
- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P2` — targeted opening
- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P3` — observer sync
- [ ] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P4` — pending reuse
- [ ] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P5` — participating reuse
- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P6` — Both lobby founders publish channel discovery records only after becoming PARTICIPATING
- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P7` — Both lobby founders open the same channel; a later spectator discovers it, synchronizes on that channel and connects to both founders
- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P8` — A later joiner discovers the lobby-opened channel and connectToChannel with shouldJoin succeeds, with its address present among on-chain pending participants
- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-1-Q80VPW.P9` — a participating caller's connect with a balance tops up through the join owner's collection: when one threshold member answers only after the request deadline, connect returns `false` and keeps `PARTICIPATING`

## UNIT-TEST-LOCAL-P2P-SIGNER-2-S5D9EJ

Ordinary lobby join leave

- Setup: Park both peers' matched negotiations at the handoff, leave from the in-process signer, then fail the negotiations unsigned
- Oracle: Each leave waits for its join and returns true; each join resolves undefined with no channel, NOT_OPENED status, and no lobby session

- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-2-S5D9EJ.P1` — same-topic leave ends both joins
- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-2-S5D9EJ.P2` — a rejected second join on the signer keeps the leave
- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-2-S5D9EJ.P3` — a differently cased leave counts, and a later leave of another topic returns false and does not undo it

## UNIT-TEST-LOCAL-P2P-SIGNER-3-3XWPRV

Targeted connect cancel before matching starts

- Setup: Hold the first on-chain opened-status read of an unopened target's connect with opening permission, cancel the connect during that read, then release the read
- Oracle: The cancel returns true; the connect returns false and no matching session or targeted topic exists

- [x] `UNIT-TEST-LOCAL-P2P-SIGNER-3-3XWPRV.P1` — a cancel during the opened-status read is kept, and the connect ends false without starting matching
