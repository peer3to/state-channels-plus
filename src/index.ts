import Clock from "@/Clock";
import {
    AContractExecutor,
    ContractExecutor,
    EvmStateMachine,
    LocalDiamondSigner,
    P2pSigner
} from "@/evm";
import P2pEventHooks from "@/P2pEventHooks";
import P2PManager from "@/P2PManager";

import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import { HandshakeCompletedGuard, LocalOnlyGuard } from "@/rpc/network/guards";
import MainRpcService from "@/rpc/network/MainRpcService";
import { NetworkTransport } from "@/transport";
import {
    Codec,
    DeployUtils,
    SignatureUtils,
    Type,
    config,
    getChecksumAddress
} from "@/utils";
export * from "@/rpc/network/services";
export type { CustomRpcConstructor, CustomRpcContext } from "@/rpc";

export { ethers } from "ethers";
export type {
    AddressLike,
    BigNumberish,
    ContractRunner,
    Provider,
    Signer
} from "ethers";

export type {
    ContractExecutionLog,
    ContractExecutionResult,
    EvmCustomPrecompile,
    EvmCustomPrecompileContext,
    EvmCustomPrecompileFactory,
    EvmCustomPrecompileManifest,
    EvmFactoryOptions,
    EvmNativeCustomPrecompile,
    GasUsageRow,
    LocalStateMachineDeployer
} from "@/evm";

export {
    AContractExecutor,
    Clock,
    ContractExecutor,
    EvmStateMachine,
    LocalDiamondSigner,
    P2pSigner,
    P2PManager,
    P2pEventHooks,
    Codec,
    DeployUtils,
    SignatureUtils,
    Type,
    config as config,
    ANetworkRpcMethods,
    ANetworkRpcService,
    MainRpcService,
    HandshakeCompletedGuard,
    LocalOnlyGuard,
    NetworkTransport,
    getChecksumAddress
};
export { DisconnectPolicy } from "@/DisconnectPolicy";
export { Status, isCommittedParticipantStatus } from "@/types";
export type { ChannelId } from "@/types";
export type { default as P2pInstance } from "@/evm/P2pInstance";
export type { P2pSetupOptions } from "@/evm/p2pRuntime/setupP2pRuntime";
export {
    EventBus,
    attachContractEvents,
    type BusEventMaps,
    type BusKind,
    type ContractEventTarget
} from "@/events/EventBus";

export { default as ClientP2pSigner } from "@/evm/signer/ClientP2pSigner";
export { default as ClientChainSigner } from "@/evm/signer/ClientChainSigner";
export type { ConnectToChannelOptions } from "@/evm/signer/ConnectToChannelOptions";
export type { OwnJoinState } from "@/stateManager/membership/MembershipService";
export type {
    SetupPayload,
    SerializedContract,
    WorkerBootstrapMessage
} from "@/evm/p2pRuntime/types";

export { Address } from "@ethereumjs/util";

export * from "@/utils/logging";
export { errorMessage } from "@/utils/errorMessage";
export {
    connectStateChannelManager,
    mergeStateChannelManagerAbi,
    stateChannelManagerAbi
} from "@/utils/stateChannelManager";
export {
    assertArtifactRuntimeSize,
    ContractSizeLimitError,
    EIP170_RUNTIME_LIMIT_BYTES,
    EIP3860_INITCODE_LIMIT_BYTES,
    InvalidContractArtifactError
} from "@/utils/contractSize";

export * from "../typechain-types";
export * as DataTypes from "../typechain-types/contracts/V1/types/DataTypes";
export * as DisputeTypes from "../typechain-types/contracts/V1/types/DisputeTypes";

export * from "../scripts/V1/deploy";

export { default as ATransport } from "./transport/ATransport";

// Generic internal RPC roots for consumers that run their own services in a
// worker or inline under an explicit local owner.
export {
    AInternalRpcRoot,
    type RuntimeConnection
} from "@/rpc/internal/AInternalRpcRoot";
export { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
export { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";
export {
    createRoot,
    startRootWorker,
    type RootConstructor,
    type RootStartContext
} from "@/rpc/internal/createRoot";
export type { RemoteRoot } from "@/rpc/internal/RemoteRoot";
export type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
export type { default as InternalTransport } from "@/transport/InternalTransport";
