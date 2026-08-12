# Implementation Coverage

> **Generated—do not edit.** Sources: `specification/`, `implementation/`, `src/`, and `contracts/`. Command: `yarn spec:refresh`.

This report checks document pairing and source-file ownership. It does not judge whether an implementation is correct.

## Contents

- [Specification and implementation mismatches](#specification-and-implementation-mismatches)
- [Source files not referenced by an implementation](#source-files-not-referenced-by-an-implementation)

## Specification and implementation mismatches

This section lists specification subjects without a matching implementation and implementation subjects without a matching or explicitly declared specification owner.

| Type                                 | Document                                                                                                                              | Missing counterpart                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Specification without implementation | [specification/block-progression/block-processing.md](../specification/block-progression/block-processing.md)                         | `implementation/block-progression/block-processing.md`           |
| Specification without implementation | [specification/disputes/dispute-processing.md](../specification/disputes/dispute-processing.md)                                       | `implementation/disputes/dispute-processing.md`                  |
| Specification without implementation | [specification/disputes/disputes.md](../specification/disputes/disputes.md)                                                           | `implementation/disputes/disputes.md`                            |
| Specification without implementation | [specification/disputes/fraud-proofs.md](../specification/disputes/fraud-proofs.md)                                                   | `implementation/disputes/fraud-proofs.md`                        |
| Specification without implementation | [specification/disputes/state-proofs.md](../specification/disputes/state-proofs.md)                                                   | `implementation/disputes/state-proofs.md`                        |
| Specification without implementation | [specification/enforcement/admission-and-funds.md](../specification/enforcement/admission-and-funds.md)                               | `implementation/enforcement/admission-and-funds.md`              |
| Specification without implementation | [specification/enforcement/contracts.md](../specification/enforcement/contracts.md)                                                   | `implementation/enforcement/contracts.md`                        |
| Specification without implementation | [specification/enforcement/dispute-window.md](../specification/enforcement/dispute-window.md)                                         | `implementation/enforcement/dispute-window.md`                   |
| Specification without implementation | [specification/enforcement/execution-and-consumer.md](../specification/enforcement/execution-and-consumer.md)                         | `implementation/enforcement/execution-and-consumer.md`           |
| Specification without implementation | [specification/enforcement/fraud-slashing.md](../specification/enforcement/fraud-slashing.md)                                         | `implementation/enforcement/fraud-slashing.md`                   |
| Specification without implementation | [specification/enforcement/local-mirror.md](../specification/enforcement/local-mirror.md)                                             | `implementation/enforcement/local-mirror.md`                     |
| Specification without implementation | [specification/enforcement/proof-verification.md](../specification/enforcement/proof-verification.md)                                 | `implementation/enforcement/proof-verification.md`               |
| Specification without implementation | [specification/enforcement/snapshot-adoption.md](../specification/enforcement/snapshot-adoption.md)                                   | `implementation/enforcement/snapshot-adoption.md`                |
| Specification without implementation | [specification/interactions.md](../specification/interactions.md)                                                                     | `implementation/interactions.md`                                 |
| Specification without implementation | [specification/peer-communication/block-gossip.md](../specification/peer-communication/block-gossip.md)                               | `implementation/peer-communication/block-gossip.md`              |
| Specification without implementation | [specification/peer-communication/channel-negotiation.md](../specification/peer-communication/channel-negotiation.md)                 | `implementation/peer-communication/channel-negotiation.md`       |
| Specification without implementation | [specification/peer-communication/dispute-acknowledgment.md](../specification/peer-communication/dispute-acknowledgment.md)           | `implementation/peer-communication/dispute-acknowledgment.md`    |
| Specification without implementation | [specification/peer-communication/handshake.md](../specification/peer-communication/handshake.md)                                     | `implementation/peer-communication/handshake.md`                 |
| Specification without implementation | [specification/peer-communication/join-authorization.md](../specification/peer-communication/join-authorization.md)                   | `implementation/peer-communication/join-authorization.md`        |
| Specification without implementation | [specification/peer-communication/rpc.md](../specification/peer-communication/rpc.md)                                                 | `implementation/peer-communication/rpc.md`                       |
| Specification without implementation | [specification/peer-communication/synchronization.md](../specification/peer-communication/synchronization.md)                         | `implementation/peer-communication/synchronization.md`           |
| Specification without implementation | [specification/peer-communication/transport-upgrade.md](../specification/peer-communication/transport-upgrade.md)                     | `implementation/peer-communication/transport-upgrade.md`         |
| Specification without implementation | [specification/protocol-model/data-types.md](../specification/protocol-model/data-types.md)                                           | `implementation/protocol-model/data-types.md`                    |
| Specification without implementation | [specification/protocol-model/finality.md](../specification/protocol-model/finality.md)                                               | `implementation/protocol-model/finality.md`                      |
| Specification without implementation | [specification/protocol-model/history-and-commitments.md](../specification/protocol-model/history-and-commitments.md)                 | `implementation/protocol-model/history-and-commitments.md`       |
| Specification without implementation | [specification/protocol-model/identity.md](../specification/protocol-model/identity.md)                                               | `implementation/protocol-model/identity.md`                      |
| Specification without implementation | [specification/protocol-model/state-machines.md](../specification/protocol-model/state-machines.md)                                   | `implementation/protocol-model/state-machines.md`                |
| Specification without implementation | [specification/protocol-model/time.md](../specification/protocol-model/time.md)                                                       | `implementation/protocol-model/time.md`                          |
| Specification without implementation | [specification/runtime/configuration.md](../specification/runtime/configuration.md)                                                   | `implementation/runtime/configuration.md`                        |
| Specification without implementation | [specification/runtime/sdk.md](../specification/runtime/sdk.md)                                                                       | `implementation/runtime/sdk.md`                                  |
| Specification without implementation | [specification/settlement/cross-layer-messages.md](../specification/settlement/cross-layer-messages.md)                               | `implementation/settlement/cross-layer-messages.md`              |
| Specification without implementation | [specification/settlement/lifecycle.md](../specification/settlement/lifecycle.md)                                                     | `implementation/settlement/lifecycle.md`                         |
| Specification without implementation | [specification/storage/blocks.md](../specification/storage/blocks.md)                                                                 | `implementation/storage/blocks.md`                               |
| Specification without implementation | [specification/storage/calldata-and-timeouts.md](../specification/storage/calldata-and-timeouts.md)                                   | `implementation/storage/calldata-and-timeouts.md`                |
| Specification without implementation | [specification/storage/dispute-evidence.md](../specification/storage/dispute-evidence.md)                                             | `implementation/storage/dispute-evidence.md`                     |
| Specification without implementation | [specification/storage/durability.md](../specification/storage/durability.md)                                                         | `implementation/storage/durability.md`                           |
| Specification without implementation | [specification/storage/message-blocks.md](../specification/storage/message-blocks.md)                                                 | `implementation/storage/message-blocks.md`                       |
| Specification without implementation | [specification/storage/participant-changes.md](../specification/storage/participant-changes.md)                                       | `implementation/storage/participant-changes.md`                  |
| Specification without implementation | [specification/storage/progress-markers.md](../specification/storage/progress-markers.md)                                             | `implementation/storage/progress-markers.md`                     |
| Specification without implementation | [specification/storage/queue.md](../specification/storage/queue.md)                                                                   | `implementation/storage/queue.md`                                |
| Specification without implementation | [specification/storage/snapshots-and-states.md](../specification/storage/snapshots-and-states.md)                                     | `implementation/storage/snapshots-and-states.md`                 |
| Implementation without specification | [implementation/architecture/contracts/architecture.md](../implementation/architecture/contracts/architecture.md)                     | `specification/architecture/contracts/architecture.md`           |
| Implementation without specification | [implementation/architecture/contracts/manager-and-facets.md](../implementation/architecture/contracts/manager-and-facets.md)         | `specification/architecture/contracts/manager-and-facets.md`     |
| Implementation without specification | [implementation/architecture/contracts/state-machine-base.md](../implementation/architecture/contracts/state-machine-base.md)         | `specification/architecture/contracts/state-machine-base.md`     |
| Implementation without specification | [implementation/architecture/contracts.md](../implementation/architecture/contracts.md)                                               | `specification/architecture/contracts.md`                        |
| Implementation without specification | [implementation/architecture/rpc.md](../implementation/architecture/rpc.md)                                                           | `specification/architecture/rpc.md`                              |
| Implementation without specification | [implementation/architecture/sdk/architecture.md](../implementation/architecture/sdk/architecture.md)                                 | `specification/architecture/sdk/architecture.md`                 |
| Implementation without specification | [implementation/architecture/sdk/block-confirmation-pipeline.md](../implementation/architecture/sdk/block-confirmation-pipeline.md)   | `specification/architecture/sdk/block-confirmation-pipeline.md`  |
| Implementation without specification | [implementation/architecture/sdk/components.md](../implementation/architecture/sdk/components.md)                                     | `specification/architecture/sdk/components.md`                   |
| Implementation without specification | [implementation/architecture/sdk/dispute-pipeline.md](../implementation/architecture/sdk/dispute-pipeline.md)                         | `specification/architecture/sdk/dispute-pipeline.md`             |
| Implementation without specification | [implementation/architecture/sdk/rpc/handshake.md](../implementation/architecture/sdk/rpc/handshake.md)                               | `specification/architecture/sdk/rpc/handshake.md`                |
| Implementation without specification | [implementation/architecture/sdk/rpc/is-fork-disputed.md](../implementation/architecture/sdk/rpc/is-fork-disputed.md)                 | `specification/architecture/sdk/rpc/is-fork-disputed.md`         |
| Implementation without specification | [implementation/architecture/sdk/rpc/join-channel.md](../implementation/architecture/sdk/rpc/join-channel.md)                         | `specification/architecture/sdk/rpc/join-channel.md`             |
| Implementation without specification | [implementation/architecture/sdk/rpc/open-channel-negotiation.md](../implementation/architecture/sdk/rpc/open-channel-negotiation.md) | `specification/architecture/sdk/rpc/open-channel-negotiation.md` |
| Implementation without specification | [implementation/architecture/sdk/rpc/spectate.md](../implementation/architecture/sdk/rpc/spectate.md)                                 | `specification/architecture/sdk/rpc/spectate.md`                 |
| Implementation without specification | [implementation/architecture/sdk/rpc/state-transition.md](../implementation/architecture/sdk/rpc/state-transition.md)                 | `specification/architecture/sdk/rpc/state-transition.md`         |
| Implementation without specification | [implementation/architecture/sdk/rpc/webrtc-setup.md](../implementation/architecture/sdk/rpc/webrtc-setup.md)                         | `specification/architecture/sdk/rpc/webrtc-setup.md`             |
| Implementation without specification | [implementation/architecture/sdk.md](../implementation/architecture/sdk.md)                                                           | `specification/architecture/sdk.md`                              |
| Implementation without specification | [implementation/concepts/history-and-commitments.md](../implementation/concepts/history-and-commitments.md)                           | `specification/concepts/history-and-commitments.md`              |
| Implementation without specification | [implementation/concepts/state-machines.md](../implementation/concepts/state-machines.md)                                             | `specification/concepts/state-machines.md`                       |
| Implementation without specification | [implementation/examples.md](../implementation/examples.md)                                                                           | `specification/examples.md`                                      |
| Implementation without specification | [implementation/operations/configuration.md](../implementation/operations/configuration.md)                                           | `specification/operations/configuration.md`                      |
| Implementation without specification | [implementation/protocol/block-processing.md](../implementation/protocol/block-processing.md)                                         | `specification/protocol/block-processing.md`                     |
| Implementation without specification | [implementation/protocol/cross-layer-messages.md](../implementation/protocol/cross-layer-messages.md)                                 | `specification/protocol/cross-layer-messages.md`                 |
| Implementation without specification | [implementation/protocol/dispute-processing.md](../implementation/protocol/dispute-processing.md)                                     | `specification/protocol/dispute-processing.md`                   |
| Implementation without specification | [implementation/protocol/disputes.md](../implementation/protocol/disputes.md)                                                         | `specification/protocol/disputes.md`                             |
| Implementation without specification | [implementation/protocol/finality.md](../implementation/protocol/finality.md)                                                         | `specification/protocol/finality.md`                             |
| Implementation without specification | [implementation/protocol/fraud-proofs.md](../implementation/protocol/fraud-proofs.md)                                                 | `specification/protocol/fraud-proofs.md`                         |
| Implementation without specification | [implementation/protocol/lifecycle.md](../implementation/protocol/lifecycle.md)                                                       | `specification/protocol/lifecycle.md`                            |
| Implementation without specification | [implementation/protocol/state-proofs.md](../implementation/protocol/state-proofs.md)                                                 | `specification/protocol/state-proofs.md`                         |
| Implementation without specification | [implementation/protocol/time.md](../implementation/protocol/time.md)                                                                 | `specification/protocol/time.md`                                 |
| Implementation without specification | [implementation/reference/data-types.md](../implementation/reference/data-types.md)                                                   | `specification/reference/data-types.md`                          |

## Source files not referenced by an implementation

This section lists files under `src/` and `contracts/` that do not appear in any implementation source inventory.

None.
