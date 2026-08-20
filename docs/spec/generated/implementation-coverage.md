# Implementation Coverage

> **Generated—do not edit.** Sources: `specification/`, `implementation/`, `src/`, and `contracts/`. Command: `yarn spec:refresh`.

## Score

- Specification IDs fully implemented (only `Covered` claims): **202/242** (83%)
- Source files with a file report: **241/243** (99%)

## Contents

- [Specification IDs not fully implemented](#specification-ids-not-fully-implemented)
- [Source files without a report](#source-files-without-a-report)

## Specification IDs not fully implemented

Every requirement/invariant whose implementation-layer conformance claim is absent, `Partial`,
`Contradicts`, `Missing`, or any other non-`Covered` status. Statuses are shown verbatim from
the claiming conformance rows; an ID absent from every conformance table has no claim at all.

| Specification ID | Status | Claimed in |
| --- | --- | --- |
| [`INV-DIS-8-1GY6Q5`](../specification/disputes/disputes.md#inv-dis-8-1gy6q5) | Contradicts | [implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol.md](../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol.md#conformance-traceability) |
| [`INV-SM-1-J7BP6D`](../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d) | Partial | [implementation/views/concepts/state-machines.md](../implementation/views/concepts/state-machines.md#conformance-traceability) |
| [`INV-SM-2-0FTJ2T`](../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t) | Partial | [implementation/views/concepts/state-machines.md](../implementation/views/concepts/state-machines.md#conformance-traceability) |
| [`REQ-BAL-1-Z8RH4V`](../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v) | Partial | [implementation/views/concepts/state-machines.md](../implementation/views/concepts/state-machines.md#conformance-traceability) |
| [`REQ-BAL-2-KTSW9B`](../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b) | Partial | [implementation/views/concepts/state-machines.md](../implementation/views/concepts/state-machines.md#conformance-traceability) |
| [`REQ-BAL-3-P7Q83F`](../specification/protocol-model/state-machines.md#req-bal-3-p7q83f) | Partial | [implementation/views/concepts/state-machines.md](../implementation/views/concepts/state-machines.md#conformance-traceability) |
| [`REQ-BLKSTORE-2-VWXP2C`](../specification/storage/blocks.md#req-blkstore-2-vwxp2c) | Contradicts | [implementation/source/src/storage/BlockStorage.ts.md](../implementation/source/src/storage/BlockStorage.ts.md#conformance-traceability) |
| [`REQ-CONFIG-1-PDHA8T`](../specification/runtime/configuration.md#req-config-1-pdha8t) | Partial | [implementation/views/operations/configuration.md](../implementation/views/operations/configuration.md#conformance-traceability) |
| [`REQ-CONFIG-2-JA2SKN`](../specification/runtime/configuration.md#req-config-2-ja2skn) | Partial | [implementation/views/operations/configuration.md](../implementation/views/operations/configuration.md#conformance-traceability) |
| [`REQ-CONFIG-3-J4H12F`](../specification/runtime/configuration.md#req-config-3-j4h12f) | Partial | [implementation/views/operations/configuration.md](../implementation/views/operations/configuration.md#conformance-traceability) |
| [`REQ-CONTRACT-ARCH-4-FZ3CJE`](../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje) | Contradicts | [implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#conformance-traceability) |
| [`REQ-CONTRACT-ARCH-5-QT17P1`](../specification/enforcement/contracts.md#req-contract-arch-5-qt17p1) | Not implemented (no conformance claim) | [specification/enforcement/contracts.md](../specification/enforcement/contracts.md#req-contract-arch-5-qt17p1) (definition) |
| [`REQ-DIS-10-SAHJBN`](../specification/disputes/disputes.md#req-dis-10-sahjbn) | Partial | [implementation/source/src/stateManager/StateManager.ts.md](../implementation/source/src/stateManager/StateManager.ts.md#conformance-traceability) |
| [`REQ-DISPUTE-PIPE-5-RZZB48`](../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48) | Partial | [implementation/source/src/disputeManager/DisputeManager.ts.md](../implementation/source/src/disputeManager/DisputeManager.ts.md#conformance-traceability) |
| [`REQ-ENFADM-1-V926CA`](../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca) | Partial | [implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md](../implementation/source/contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#conformance-traceability) |
| [`REQ-GOSSIP-2-9PMMNH`](../specification/peer-communication/block-gossip.md#req-gossip-2-9pmmnh) | Partial | [implementation/source/src/rpc/services/stateTransition/StateTransitionRpcMethods.ts.md](../implementation/source/src/rpc/services/stateTransition/StateTransitionRpcMethods.ts.md#conformance-traceability) |
| [`REQ-MIRROR-2-E9F3TM`](../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm) | Partial | [implementation/source/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md](../implementation/source/contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol.md#conformance-traceability)<br>[implementation/source/src/evm/EvmDiamondStateMachine.ts.md](../implementation/source/src/evm/EvmDiamondStateMachine.ts.md#conformance-traceability) |
| [`REQ-MSGSTORE-1-6ME9D7`](../specification/storage/message-blocks.md#req-msgstore-1-6me9d7) | Contradicts | [implementation/source/src/storage/MessageBlockStorage.ts.md](../implementation/source/src/storage/MessageBlockStorage.ts.md#conformance-traceability) |
| [`REQ-MSGSTORE-2-8RDXPZ`](../specification/storage/message-blocks.md#req-msgstore-2-8rdxpz) | Contradicts | [implementation/source/src/storage/MessageBlockStorage.ts.md](../implementation/source/src/storage/MessageBlockStorage.ts.md#conformance-traceability) |
| [`REQ-NEG-3-Q5WFAA`](../specification/peer-communication/channel-negotiation.md#req-neg-3-q5wfaa) | Partial | [implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts.md](../implementation/source/src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts.md#conformance-traceability) |
| [`REQ-RPC-2-SZDTTM`](../specification/peer-communication/rpc.md#req-rpc-2-szdttm) | Partial | [implementation/source/src/rpc/ARpcService.ts.md](../implementation/source/src/rpc/ARpcService.ts.md#conformance-traceability) |
| [`REQ-RPC-6-E60S4J`](../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) | Partial; Contradicts | [implementation/source/src/rpc/ARpcService.ts.md](../implementation/source/src/rpc/ARpcService.ts.md#conformance-traceability)<br>[implementation/source/src/utils/ObjectChecks.ts.md](../implementation/source/src/utils/ObjectChecks.ts.md#conformance-traceability) |
| [`REQ-RPC-7-9CBSHK`](../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) | Partial; Missing | [implementation/source/src/rpc/guards/HandshakeCompletedGuard.ts.md](../implementation/source/src/rpc/guards/HandshakeCompletedGuard.ts.md#conformance-traceability)<br>[implementation/views/architecture/sdk/rpc/README.md](../implementation/views/architecture/sdk/rpc/README.md#implementation-traceability) |
| [`REQ-RPC-8-44XECF`](../specification/peer-communication/rpc.md#req-rpc-8-44xecf) | Missing | [implementation/source/src/rpc/services/initHandshake/InitHandshakeService.ts.md](../implementation/source/src/rpc/services/initHandshake/InitHandshakeService.ts.md#conformance-traceability) |
| [`REQ-SM-1-Y72CKX`](../specification/protocol-model/state-machines.md#req-sm-1-y72ckx) | Partial | [implementation/views/concepts/state-machines.md](../implementation/views/concepts/state-machines.md#conformance-traceability) |
| [`REQ-SM-2-PHCRFR`](../specification/protocol-model/state-machines.md#req-sm-2-phcrfr) | Partial | [implementation/views/concepts/state-machines.md](../implementation/views/concepts/state-machines.md#conformance-traceability) |
| [`REQ-SM-3-88RFP2`](../specification/protocol-model/state-machines.md#req-sm-3-88rfp2) | Partial | [implementation/views/concepts/state-machines.md](../implementation/views/concepts/state-machines.md#conformance-traceability) |
| [`REQ-SM-4-Z32M0W`](../specification/protocol-model/state-machines.md#req-sm-4-z32m0w) | Partial | [implementation/views/concepts/state-machines.md](../implementation/views/concepts/state-machines.md#conformance-traceability) |
| [`REQ-SM-6-BJZVQ5`](../specification/protocol-model/state-machines.md#req-sm-6-bjzvq5) | Partial | [implementation/views/concepts/state-machines.md](../implementation/views/concepts/state-machines.md#conformance-traceability) |
| [`REQ-SM-7-Y38NTY`](../specification/protocol-model/state-machines.md#req-sm-7-y38nty) | Partial | [implementation/views/concepts/state-machines.md](../implementation/views/concepts/state-machines.md#conformance-traceability) |
| [`REQ-SM-8-8CHSQ8`](../specification/protocol-model/state-machines.md#req-sm-8-8chsq8) | Contradicts | [implementation/views/concepts/state-machines.md](../implementation/views/concepts/state-machines.md#conformance-traceability) |
| [`REQ-SM-9-QK86SJ`](../specification/protocol-model/state-machines.md#req-sm-9-qk86sj) | Partial | [implementation/views/concepts/state-machines.md](../implementation/views/concepts/state-machines.md#conformance-traceability) |
| [`REQ-SNAPSTORE-2-Q7E6TQ`](../specification/storage/snapshots-and-states.md#req-snapstore-2-q7e6tq) | Contradicts | [implementation/source/src/storage/Storage.ts.md](../implementation/source/src/storage/Storage.ts.md#conformance-traceability) |
| [`REQ-STOR-1-D4XE73`](../specification/storage/durability.md#req-stor-1-d4xe73) | Partial | [implementation/source/src/storage/Storage.ts.md](../implementation/source/src/storage/Storage.ts.md#conformance-traceability) |
| [`REQ-STOR-4-MF6FT6`](../specification/storage/durability.md#req-stor-4-mf6ft6) | Partial | [implementation/source/src/storage/Storage.ts.md](../implementation/source/src/storage/Storage.ts.md#conformance-traceability) |
| [`REQ-STOR-5-T6EQSA`](../specification/storage/durability.md#req-stor-5-t6eqsa) | Partial | [implementation/source/src/storage/Storage.ts.md](../implementation/source/src/storage/Storage.ts.md#conformance-traceability) |
| [`REQ-STOR-6-SKP0KM`](../specification/storage/durability.md#req-stor-6-skp0km) | `Contradicts` | [implementation/source/src/utils/DeepCopyProxy.ts.md](../implementation/source/src/utils/DeepCopyProxy.ts.md#conformance-traceability) |
| [`REQ-SYNC-1-T2589H`](../specification/peer-communication/synchronization.md#req-sync-1-t2589h) | Partial | [implementation/source/src/rpc/services/spectate/SpectateRpcMethods.ts.md](../implementation/source/src/rpc/services/spectate/SpectateRpcMethods.ts.md#conformance-traceability)<br>[implementation/source/src/rpc/services/spectate/SpectateService.ts.md](../implementation/source/src/rpc/services/spectate/SpectateService.ts.md#conformance-traceability) |
| [`REQ-TRUST-4-KW24NF`](../specification/security/trust-model.md#req-trust-4-kw24nf) | Partial | [implementation/views/security/trust-model.md](../implementation/views/security/trust-model.md#conformance-traceability) |
| [`REQ-UPG-1-MFBTZ1`](../specification/peer-communication/transport-upgrade.md#req-upg-1-mfbtz1) | Partial | [implementation/source/src/rpc/services/WebRTCSetup/WebRTCSetupService.ts.md](../implementation/source/src/rpc/services/WebRTCSetup/WebRTCSetupService.ts.md#conformance-traceability) |

## Source files without a report

Every file under `src/` and `contracts/` needs one maintained report at
`implementation/source/<path>.md`.

| Source file |
| --- |
| [src/cache/index.ts](../../../src/cache/index.ts) |
| [src/cache/SignerRecoveryCache.ts](../../../src/cache/SignerRecoveryCache.ts) |
