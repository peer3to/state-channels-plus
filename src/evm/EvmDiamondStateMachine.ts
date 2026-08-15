import type { EvmCustomPrecompileManifest } from "./EvmFactory";
import { ethers, Signer } from "ethers";
import {
    StateChannelManagerProxy,
    AStateMachine as AStateMachineContract,
    LocalDiamond
} from "@typechain-types";
import { TransactionStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import StateManager from "../stateManager/StateManager";
import { TimeConfig } from "@/types";
import { BalanceEthersType, MessageEthersType } from "@/types/ethers";
import {
    Codec,
    convertEthersValue,
    createLogger,
    Logger,
    createEthersResultProxy
} from "@/utils";
import ADiamondStateMachine from "@/ADiamondStateMachine";
import P2pInstance from "./P2pInstance";
import {
    type AContractExecutor,
    type ContractExecutionLog
} from "./contractExecutor";
import { Address, Bytes } from "@/types/types";
import {
    BalanceStruct,
    MessageStruct
} from "@typechain-types/contracts/V1/AStateMachine";
import {
    deployLocalDiamondWithStateMachineAddress,
    DeploymentResult,
    LocalStateMachineDeployer
} from "scripts/V1/deploy";
import LocalContractExecutorSigner from "./signer/LocalContractExecutorSigner";
import { LocalDiamondArtifact } from "@/utils/GeneratedArtifacts";

import { createConfig, Config } from "@/utils/config";
import MainRpcService from "@/rpc/MainRpcService";
import {
    createRuntimeChannel,
    createTransferableChannel
} from "@platform/p2pRuntimeChannel";
import { createP2pRuntimeWorker } from "@platform/p2pRuntimeWorkerRuntime";
import { startP2pRuntimeHost } from "./p2pRuntime/P2pRuntimeHost";
import type { HostHandlerExecutionContext } from "./p2pRuntime/HostHandlerExecutionContext";
import P2pRuntimeClient from "./p2pRuntime/P2pRuntimeClient";
import DeploymentBridgeSigner from "./signer/DeploymentBridgeSigner";
import type {
    RuntimePort,
    SerializedContract,
    SetupPayload,
    WorkerBootstrapMessage
} from "./p2pRuntime/types";
import type { CustomRpcManifest } from "@/rpc/registry";

/**
 * Manages peer-to-peer communication and state machines
 * Also serves as the implementation of AStateMachine
 */
class EvmDiamondStateMachine extends ADiamondStateMachine {
    readonly contractExecutor: AContractExecutor;
    readonly contractInterface: ethers.Interface;
    private readonly stateMachineAddress: Address;
    public stateManager?: StateManager;

    constructor(
        contractExecutor: AContractExecutor,
        stateMachineAddress: Address,
        contractInterface: ethers.Interface,
        localDiamondContract: LocalDiamond
    ) {
        super(localDiamondContract);
        this.contractExecutor = contractExecutor;
        this.stateMachineAddress = stateMachineAddress;
        this.contractInterface = contractInterface;
    }

    private getEncodedCalldata(
        functionName: string,
        args: any[] = []
    ): Uint8Array {
        return ethers.getBytes(
            this.contractInterface.encodeFunctionData(functionName, args)
        );
    }

    private createContextError(methodName: string, error: unknown): Error {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        return new Error(
            `StateMachineInterface.${methodName}: ${errorMessage}`
        );
    }

    public getStateMachineAddress(): Address {
        return this.stateMachineAddress;
    }

    public setStateManager(stateManager: StateManager) {
        this.stateManager = stateManager;
    }

    public async dispose(): Promise<void> {
        await this.contractExecutor.dispose();
    }

    /**
     * Process logs from an EVM call and emit corresponding events.
     *
     * @param logs The log output from the EVM
     */
    public processLogs(logs?: ContractExecutionLog[]): void {
        if (!logs || logs.length === 0) return;

        for (const log of logs) {
            let event: ethers.LogDescription | null;
            try {
                event = this.contractInterface.parseLog(log);
            } catch {
                // Unknown log event - ignore silently
                continue;
            }
            if (!event) continue;
            // Nested ethers Results are not structured-cloneable, so the port
            // bridge would drop any event carrying an array argument. The
            // canonical converter keeps struct field names; the top level
            // stays positional for emit(name, ...args).
            const args = convertEthersValue(Object.values(event.args));

            // The one publication: bus listeners in this realm (isolated), any
            // attached ethers instances (via attachContractEvents), and the
            // port bridge to the other realm all ride this emit. This runs
            // synchronously inside the transition success path, BEFORE the
            // next onTurn publishes — ordering-critical consumers subscribe on
            // the bus. A bridge failure is logged and processing continues:
            // a contract event must never fail the transition.
            try {
                this.stateManager?.events.emit(
                    "contractEvents",
                    event.name,
                    args
                );
            } catch (error) {
                this.stateManager?.logger.error("Contract event emit failed", {
                    eventName: event.name,
                    error:
                        error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    async stateTransition(tx: TransactionStruct) {
        const encodedData = this.getEncodedCalldata("stateTransition", [tx]);

        try {
            const result = await this.contractExecutor.executeCall(
                encodedData,
                this.stateMachineAddress
            );
            // Decode the return values: (bool success, Message[] outboundMessages)
            const [success, outboundMessages] =
                ethers.AbiCoder.defaultAbiCoder().decode(
                    ["bool", `${MessageEthersType}[]`],
                    result.returnValue
                );
            return {
                success: Boolean(success),
                successCallback: () => this.processLogs(result.logs),
                outboundMessages: Codec.ethersResultToObjectRecursive(
                    outboundMessages as ethers.Result
                ) as unknown as MessageStruct[]
            };
        } catch {
            return {
                success: false,
                successCallback: () => {},
                outboundMessages: []
            };
        }
    }

    async runView(tx: ethers.TransactionRequest): Promise<string> {
        try {
            const result = await this.contractExecutor.simulateCall(
                tx.data as Bytes,
                this.stateMachineAddress
            );
            return result.returnValue;
        } catch (error) {
            throw this.createContextError("runView", error);
        }
    }

    async getParticipants(): Promise<Address[]> {
        const callData = this.getEncodedCalldata("getParticipants");

        const addresses = Codec.decodeEvmResult<Address[]>(
            await this.contractExecutor.simulateCall(
                callData,
                this.stateMachineAddress
            ),
            "address[]"
        );
        return addresses;
    }

    async getNextToWrite(): Promise<Address> {
        const callData = this.getEncodedCalldata("getNextToWrite");
        try {
            return Codec.decodeEvmResult<Address>(
                await this.contractExecutor.simulateCall(
                    callData,
                    this.stateMachineAddress
                ),
                "address"
            );
        } catch (error) {
            throw this.createContextError("getNextToWrite", error);
        }
    }

    async peekNextToWrite(encodedState: Bytes): Promise<Address> {
        const state = await this.getState();
        await this.setState(encodedState);
        const nextToWrite = await this.getNextToWrite();
        await this.setState(state);
        return nextToWrite;
    }

    async setState(serializedState: Bytes): Promise<boolean> {
        const encodedData = this.getEncodedCalldata("setState", [
            serializedState
        ]);

        try {
            await this.contractExecutor.executeCall(
                encodedData,
                this.stateMachineAddress
            );
            return true;
        } catch (error) {
            throw this.createContextError("setState", error);
        }
    }

    async getState(): Promise<Bytes> {
        const callData = this.getEncodedCalldata("getState");

        try {
            return Codec.decodeEvmResult<Bytes>(
                await this.contractExecutor.simulateCall(
                    callData,
                    this.stateMachineAddress
                ),
                "bytes"
            );
        } catch (error) {
            throw this.createContextError("getState", error);
        }
    }

    async getZeroBalance(): Promise<BalanceStruct> {
        const callData = this.getEncodedCalldata("getZeroBalance");

        try {
            return Codec.decodeEvmResult<BalanceStruct>(
                await this.contractExecutor.simulateCall(
                    callData,
                    this.stateMachineAddress
                ),
                BalanceEthersType
            );
        } catch (error) {
            throw this.createContextError("getZeroBalance", error);
        }
    }

    async addBalance(
        balance1: BalanceStruct,
        balance2: BalanceStruct
    ): Promise<BalanceStruct> {
        const callData = this.getEncodedCalldata("addBalance", [
            balance1,
            balance2
        ]);

        try {
            return Codec.decodeEvmResult<BalanceStruct>(
                await this.contractExecutor.simulateCall(
                    callData,
                    this.stateMachineAddress
                ),
                BalanceEthersType
            );
        } catch (error) {
            throw this.createContextError("addBalance", error);
        }
    }

    async subtractBalance(
        balance1: BalanceStruct,
        balance2: BalanceStruct
    ): Promise<BalanceStruct> {
        const callData = this.getEncodedCalldata("subtractBalance", [
            balance1,
            balance2
        ]);

        try {
            return Codec.decodeEvmResult<BalanceStruct>(
                await this.contractExecutor.simulateCall(
                    callData,
                    this.stateMachineAddress
                ),
                BalanceEthersType
            );
        } catch (error) {
            throw this.createContextError("subtractBalance", error);
        }
    }

    async areBalancesEqual(
        balance1: BalanceStruct,
        balance2: BalanceStruct
    ): Promise<boolean> {
        const callData = this.getEncodedCalldata("areBalancesEqual", [
            balance1,
            balance2
        ]);

        try {
            return Codec.decodeEvmResult<boolean>(
                await this.contractExecutor.simulateCall(
                    callData,
                    this.stateMachineAddress
                ),
                "bool"
            );
        } catch (error) {
            throw this.createContextError("areBalancesEqual", error);
        }
    }

    async processInboundMessage(message: MessageStruct): Promise<boolean> {
        const callData = this.getEncodedCalldata("processInboundMessage", [
            message
        ]);

        try {
            const result = await this.contractExecutor.executeCall(
                callData,
                this.stateMachineAddress
            );
            const [success] = ethers.AbiCoder.defaultAbiCoder().decode(
                ["bool"],
                result.returnValue
            );
            this.processLogs(result.logs);
            return Boolean(success);
        } catch (error) {
            throw this.createContextError("processInboundMessage", error);
        }
    }

    async getTotalStateBalance(): Promise<BalanceStruct> {
        const callData = this.getEncodedCalldata("getTotalStateBalance");

        try {
            return Codec.decodeEvmResult<BalanceStruct>(
                await this.contractExecutor.simulateCall(
                    callData,
                    this.stateMachineAddress
                ),
                BalanceEthersType,
                { useObjectConversion: true }
            );
        } catch (error) {
            throw this.createContextError("getTotalStateBalance", error);
        }
    }

    /**
     * Creates a standalone EVM state machine
     * @param deployStateMachine A deployer that creates the replicated state machine locally
     * @param contractInterface The interface of the state machine contract
     * @returns A new EvmStateMachine instance
     */
    public static async createStandaloneFromLocalStateMachineWithExecutor(
        contractExecutor: AContractExecutor,
        localStateMachineAddress: Address,
        diamondStateMachineAddress: Address,
        contractInterface: ethers.Interface,
        signer: Signer,
        timeConfig: TimeConfig,
        disputeExecutionGasLimit: number
    ): Promise<{
        evmDiamondStateMachine: EvmDiamondStateMachine;
        deploymentResult: DeploymentResult;
    }> {
        const localSigner = new LocalContractExecutorSigner(
            signer,
            contractExecutor
        );

        // The diamond gets its own dedicated state machine instance so its
        // dispute execution never mutates the replicated working state held at
        // `localStateMachineAddress`.
        const diamondResult = await deployLocalDiamondWithStateMachineAddress(
            diamondStateMachineAddress,
            localSigner,
            timeConfig,
            disputeExecutionGasLimit
        );

        const localDiamondContract = new ethers.Contract(
            diamondResult.address.toString(),
            LocalDiamondArtifact.abi,
            localSigner
        ) as unknown as LocalDiamond;

        const proxiedLocalDiamond =
            createEthersResultProxy(localDiamondContract);

        return {
            evmDiamondStateMachine: new EvmDiamondStateMachine(
                contractExecutor,
                localStateMachineAddress,
                contractInterface,
                proxiedLocalDiamond
            ),
            deploymentResult: diamondResult
        };
    }

    /**
     * Sets up a P2P interaction environment with the state machine
     * @param deployedStateChannelContractInstance The deployed state channel manager proxy
     * @param stateMachineContractInstance The state machine contract instance
     * @param deployStateMachine A deployer that creates local state machine instances
     * @param p2pEventHooks Optional event hooks for P2P interactions
     * @param timeConfigOverride Optional time configuration override for testing
     * @returns Promise with the created P2P interaction object
     */
    public static async p2pSetup<
        T extends AStateMachineContract,
        TCustomRpc extends MainRpcService = MainRpcService
    >(
        deployedStateChannelContractInstance: StateChannelManagerProxy,
        stateMachineContractInstance: T,
        deployStateMachine: LocalStateMachineDeployer,
        options?: {
            peerId?: number;
            peerLogger?: Logger;
            customRpcManifest?: CustomRpcManifest;
            /**
             * Runtime configuration. PROVIDER_URL must expose WebSocket RPC on
             * the same authority; http(s) URLs are converted to ws(s).
             */
            config?: Partial<Config>;
            customPrecompiles?: EvmCustomPrecompileManifest[];
            /**
             * Signer secret (private key or mnemonic) owned by the runtime host.
             * Injected signers are intentionally unsupported; a random private
             * key is generated when omitted.
             */
            signerSecret?: string;
            /**
             * Context every inline-host handler runs inside (see
             * {@link HostHandlerExecutionContext}). Ignored in threaded mode —
             * a worker thread runs exactly one peer's host.
             */
            handlerExecutionContext?: HostHandlerExecutionContext;
        }
    ): Promise<P2pInstance<T, TCustomRpc>> {
        // Initialize SDK config for this runtime (intended to be called once).
        const activeConfig = createConfig(options?.config);

        const runtimeSignerSecret =
            options?.signerSecret ?? ethers.Wallet.createRandom().privateKey;
        const trimmedSignerSecret = runtimeSignerSecret.trim();
        const resolvedSignerAddress = /^0x[0-9a-fA-F]{64}$/.test(
            trimmedSignerSecret
        )
            ? new ethers.Wallet(trimmedSignerSecret).address
            : ethers.Wallet.fromPhrase(trimmedSignerSecret).address;

        const logger =
            options?.peerLogger ||
            createLogger(
                { peerId: options?.peerId, peerAddress: resolvedSignerAddress },
                { component: "ClientApp" },
                { attachErrorListener: true }
            );

        // Main-thread description of the app contract (rebuilt by the client).
        const stateMachine: SerializedContract = {
            address: (
                await stateMachineContractInstance.getAddress()
            ).toString(),
            abiJson: stateMachineContractInstance.interface.formatJson()
        };

        const scm: SerializedContract = {
            address: (
                await deployedStateChannelContractInstance.getAddress()
            ).toString(),
            abiJson: deployedStateChannelContractInstance.interface.formatJson()
        };
        const clientProvider =
            deployedStateChannelContractInstance.runner?.provider;
        if (!clientProvider) {
            throw new Error(
                "p2pSetup requires the state channel manager to have a provider"
            );
        }

        const payload: SetupPayload = {
            config: activeConfig,
            scm,
            stateMachine,
            signerSecret: runtimeSignerSecret,
            peerId: options?.peerId,
            customRpcManifest: options?.customRpcManifest,
            customPrecompiles: options?.customPrecompiles
        };

        let clientPort: RuntimePort;
        let onClose: (() => void) | undefined;

        if (activeConfig.RUN_SDK_IN_THREAD) {
            const { localPort, transferablePort } = createTransferableChannel();
            const worker = createP2pRuntimeWorker();
            const bootstrap: WorkerBootstrapMessage = {
                type: "connect",
                payload,
                port: transferablePort
            };
            worker.postMessage(bootstrap, [transferablePort]);
            clientPort = localPort;
            onClose = () => worker.shutdown();
        } else {
            const channel = createRuntimeChannel();
            clientPort = channel.port1;
            void startP2pRuntimeHost(channel.port2, payload, {
                handlerExecutionContext: options?.handlerExecutionContext
            }).catch((error) => {
                logger.error("Inline runtime host failed", { error });
            });
        }

        const client = new P2pRuntimeClient<T>(clientPort, {
            signerAddress: resolvedSignerAddress,
            stateMachine,
            scm,
            provider: clientProvider,
            logger,
            onClose
        });

        const deployBridgeSigner = new DeploymentBridgeSigner(
            client,
            resolvedSignerAddress
        );
        // Deploy two independent local state machine instances:
        //  - one drives the replicated channel state (EvmDiamondStateMachine)
        //  - one is embedded in the LocalDiamond for dispute execution
        // They must be separate so dispute replay never clobbers live state.
        const localStateMachineAddress =
            await deployStateMachine(deployBridgeSigner);
        const diamondStateMachineAddress =
            await deployStateMachine(deployBridgeSigner);
        try {
            await client.request<void>({
                type: "deployComplete",
                localStateMachineAddress: localStateMachineAddress.toString(),
                diamondStateMachineAddress:
                    diamondStateMachineAddress.toString()
            });
            await client.ready;
        } catch (error) {
            await client.dispose();
            throw error;
        }

        const p2pInstance = new P2pInstance<T, TCustomRpc>(client, logger);
        // On the main thread the surfaced WebRTC bridge port has no further
        // worker nesting to bubble up to, so wire it to the local
        // RTCPeerConnection here; inside a worker it stays on
        // p2pInstance.webRTCBridgePort for the consumer app to bubble up.
        p2pInstance.installMainThreadBridgeIfOnMainThread();
        return p2pInstance;
    }
}

export default EvmDiamondStateMachine;
