# src/utils — Subsystem

> **Status:** Skeleton — subsystem responsibility, design, assumptions, interactions, and
> integration obligations pending authoring.

_Pending authoring: shared responsibility, design decisions, assumptions, cross-file interactions, and integration obligations of this subsystem._

## Contents

- [runCleanup.ts](./runCleanup.ts.md)

- [BarrierLocal.ts](./BarrierLocal.ts.md)
- [Codec.ts](./Codec.ts.md)
- [DebugProxy.ts](./DebugProxy.ts.md)
- [DeepCopyProxy.ts](./DeepCopyProxy.ts.md)
- [DeployUtils.ts](./DeployUtils.ts.md)
- [DetachedPromises.ts](./DetachedPromises.ts.md)
- [EthersResultProxy.ts](./EthersResultProxy.ts.md)
- [EventBarrier.ts](./EventBarrier.ts.md)
- [GeneratedArtifacts.ts](./GeneratedArtifacts.ts.md)
- [LocalDiscoveryServer.ts](./LocalDiscoveryServer.ts.md)
- [LoggerUtils.ts](./LoggerUtils.ts.md)
- [Mutex.ts](./Mutex.ts.md)
- [ObjectChecks.ts](./ObjectChecks.ts.md)
- [P2pEventHooksUtils.ts](./P2pEventHooksUtils.ts.md)
- [SignatureCollectionMap.ts](./SignatureCollectionMap.ts.md)
- [SignatureUtils.ts](./SignatureUtils.ts.md)
- [TimeoutManager.ts](./TimeoutManager.ts.md)
- [address.ts](./address.ts.md)
- [bytes32.ts](./bytes32.ts.md)
- [channelKey.ts](./channelKey.ts.md)
- [config.ts](./config.ts.md)
- [contractAbi.ts](./contractAbi.ts.md)
- [contractSize.ts](./contractSize.ts.md)
- [discoveryKey.ts](./discoveryKey.ts.md)
- [errorMessage.ts](./errorMessage.ts.md)
- [errorPeerAddress.ts](./errorPeerAddress.ts.md)
- [evmErrorHandler.ts](./evmErrorHandler.ts.md)
- [hash.ts](./hash.ts.md)
- [index.ts](./index.ts.md)
- [localDiamond.ts](./localDiamond.ts.md)
- [participantUtils.ts](./participantUtils.ts.md)
- [retry.ts](./retry.ts.md)
- [routedFacets.ts](./routedFacets.ts.md)
- [scheduler.ts](./scheduler.ts.md)
- [set.ts](./set.ts.md)
- [stateChannelManager.ts](./stateChannelManager.ts.md)
- [browser](./browser/README.md)
- [logging](./logging/README.md)
- [moduleLoader](./moduleLoader/README.md)
- [node](./node/README.md)

## Source inventory

| Source | Report |
| --- | --- |
| [BarrierLocal.ts](../../../../../../src/utils/BarrierLocal.ts) | [BarrierLocal.ts.md](./BarrierLocal.ts.md) |
| [Codec.ts](../../../../../../src/utils/Codec.ts) | [Codec.ts.md](./Codec.ts.md) |
| [DebugProxy.ts](../../../../../../src/utils/DebugProxy.ts) | [DebugProxy.ts.md](./DebugProxy.ts.md) |
| [DeepCopyProxy.ts](../../../../../../src/utils/DeepCopyProxy.ts) | [DeepCopyProxy.ts.md](./DeepCopyProxy.ts.md) |
| [DeployUtils.ts](../../../../../../src/utils/DeployUtils.ts) | [DeployUtils.ts.md](./DeployUtils.ts.md) |
| [DetachedPromises.ts](../../../../../../src/utils/DetachedPromises.ts) | [DetachedPromises.ts.md](./DetachedPromises.ts.md) |
| [EthersResultProxy.ts](../../../../../../src/utils/EthersResultProxy.ts) | [EthersResultProxy.ts.md](./EthersResultProxy.ts.md) |
| [EventBarrier.ts](../../../../../../src/utils/EventBarrier.ts) | [EventBarrier.ts.md](./EventBarrier.ts.md) |
| [GeneratedArtifacts.ts](../../../../../../src/utils/GeneratedArtifacts.ts) | [GeneratedArtifacts.ts.md](./GeneratedArtifacts.ts.md) |
| [LocalDiscoveryServer.ts](../../../../../../src/utils/LocalDiscoveryServer.ts) | [LocalDiscoveryServer.ts.md](./LocalDiscoveryServer.ts.md) |
| [LoggerUtils.ts](../../../../../../src/utils/LoggerUtils.ts) | [LoggerUtils.ts.md](./LoggerUtils.ts.md) |
| [Mutex.ts](../../../../../../src/utils/Mutex.ts) | [Mutex.ts.md](./Mutex.ts.md) |
| [ObjectChecks.ts](../../../../../../src/utils/ObjectChecks.ts) | [ObjectChecks.ts.md](./ObjectChecks.ts.md) |
| [P2pEventHooksUtils.ts](../../../../../../src/utils/P2pEventHooksUtils.ts) | [P2pEventHooksUtils.ts.md](./P2pEventHooksUtils.ts.md) |
| [SignatureCollectionMap.ts](../../../../../../src/utils/SignatureCollectionMap.ts) | [SignatureCollectionMap.ts.md](./SignatureCollectionMap.ts.md) |
| [SignatureUtils.ts](../../../../../../src/utils/SignatureUtils.ts) | [SignatureUtils.ts.md](./SignatureUtils.ts.md) |
| [TimeoutManager.ts](../../../../../../src/utils/TimeoutManager.ts) | [TimeoutManager.ts.md](./TimeoutManager.ts.md) |
| [address.ts](../../../../../../src/utils/address.ts) | [address.ts.md](./address.ts.md) |
| [bytes32.ts](../../../../../../src/utils/bytes32.ts) | [bytes32.ts.md](./bytes32.ts.md) |
| [channelKey.ts](../../../../../../src/utils/channelKey.ts) | [channelKey.ts.md](./channelKey.ts.md) |
| [config.ts](../../../../../../src/utils/config.ts) | [config.ts.md](./config.ts.md) |
| [contractAbi.ts](../../../../../../src/utils/contractAbi.ts) | [contractAbi.ts.md](./contractAbi.ts.md) |
| [contractSize.ts](../../../../../../src/utils/contractSize.ts) | [contractSize.ts.md](./contractSize.ts.md) |
| [discoveryKey.ts](../../../../../../src/utils/discoveryKey.ts) | [discoveryKey.ts.md](./discoveryKey.ts.md) |
| [errorMessage.ts](../../../../../../src/utils/errorMessage.ts) | [errorMessage.ts.md](./errorMessage.ts.md) |
| [errorPeerAddress.ts](../../../../../../src/utils/errorPeerAddress.ts) | [errorPeerAddress.ts.md](./errorPeerAddress.ts.md) |
| [evmErrorHandler.ts](../../../../../../src/utils/evmErrorHandler.ts) | [evmErrorHandler.ts.md](./evmErrorHandler.ts.md) |
| [hash.ts](../../../../../../src/utils/hash.ts) | [hash.ts.md](./hash.ts.md) |
| [index.ts](../../../../../../src/utils/index.ts) | [index.ts.md](./index.ts.md) |
| [localDiamond.ts](../../../../../../src/utils/localDiamond.ts) | [localDiamond.ts.md](./localDiamond.ts.md) |
| [participantUtils.ts](../../../../../../src/utils/participantUtils.ts) | [participantUtils.ts.md](./participantUtils.ts.md) |
| [retry.ts](../../../../../../src/utils/retry.ts) | [retry.ts.md](./retry.ts.md) |
| [routedFacets.ts](../../../../../../src/utils/routedFacets.ts) | [routedFacets.ts.md](./routedFacets.ts.md) |
| [scheduler.ts](../../../../../../src/utils/scheduler.ts) | [scheduler.ts.md](./scheduler.ts.md) |
| [set.ts](../../../../../../src/utils/set.ts) | [set.ts.md](./set.ts.md) |
| [stateChannelManager.ts](../../../../../../src/utils/stateChannelManager.ts) | [stateChannelManager.ts.md](./stateChannelManager.ts.md) |
