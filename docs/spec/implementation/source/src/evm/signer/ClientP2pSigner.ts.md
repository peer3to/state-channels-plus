# ClientP2pSigner.ts

> **Source:** [src/evm/signer/ClientP2pSigner.ts](../../../../../../../src/evm/signer/ClientP2pSigner.ts)

## Requirements

- [`REQ-ID-3-KR0BE3` (Confined signing authority)](../../../../../specification/protocol-model/identity.md#req-id-3-kr0be3)
- [`REQ-TJOIN-1-5VGR1F` (Independent public options)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-1-5vgr1f)
- [`REQ-TJOIN-6-0HEVYH` (Single-channel runtime ownership)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-6-0hevyh)
- [`REQ-TJOIN-7-NNGTAY` (Terminal channel leave)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay)
- [`REQ-SDK-ARCH-7-H64K87` (Open connections are observable)](../../../../../specification/runtime/sdk.md#req-sdk-arch-7-h64k87)
- [`REQ-JOINSIG-4-3NBKHK` (Full-channel join)](../../../../../specification/peer-communication/join-authorization.md#req-joinsig-4-3nbkhk)

## UNIT-TEST-CLIENT-P2P-SIGNER-1-HY9PZB

Connect option validation and forwarding

- Setup: Call the client signer's `connectToChannel` with an option of the wrong type, or with a join and the spectate-when-full option to an open channel already at its maximum participant count
- Oracle: A wrong type rejects with the option's type error, and the runtime keeps no channel ID and `NOT_OPENED` status; a valid option reaches the runtime, so the join to the full channel returns `false` and the runtime stays `SYNCED` with no abort

- [x] `UNIT-TEST-CLIENT-P2P-SIGNER-1-HY9PZB.P1` — a non-boolean `shouldSpectateWhenFull` rejects with "shouldSpectateWhenFull must be a boolean"
- [x] `UNIT-TEST-CLIENT-P2P-SIGNER-1-HY9PZB.P2` — `shouldSpectateWhenFull: true` with `shouldJoin` on an already open full channel reaches the runtime: `false`, `SYNCED`, and no abort
