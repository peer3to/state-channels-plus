import type { EvmCustomPrecompileManifest } from "./EvmFactory";
import { ethers, Signer } from "ethers";
import {
    StateChannelManagerProxy,
    AStateMachine as AStateMachineContract,
    LocalDiamond
} from "@typechain-types";
import { TransactionStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import StateManager from "../stateManager/StateManager";
import Clock from "@/Clock";
import { TimeConfig } from "@/types";
import { BalanceEthersType, MessageEthersType } from "@/types/ethers";
import {
    DebugProxy,
    Codec,
    createLogger,
    Logger,
    createEthersResultProxy
} from "@/utils";
import P2pEventHooks from "@/P2pEventHooks";
import ADiamondStateMachine from "@/ADiamondStateMachine";
import P2pInstance from "./P2pInstance";
import P2pSigner from "./P2pSigner";
import {
    createContractExecutorFactory,
    type AContractExecutor,
    type ContractExecutionLog
} from "./contractExecutor";
import { Address, Bytes } from "@/types/types";
import {
    BalanceStruct,
    MessageStruct
} from "@typechain-types/contracts/V1/AStateMachine";
import Storage from "@/storage";
import {
    deployLocalDiamond,
    DeploymentResult,
    LocalStateMachineDeployer
} from "scripts/V1/deploy";
import LocalDiamondSigner from "./LocalDiamondSigner";
import { LocalDiamondArtifact } from "@/utils/GeneratedArtifacts";

import { createConfig, config, Config } from "@/utils/config";
import type { RpcServiceFactoryMap } from "@/rpc/registry";
import { LoggerUtils } from "@/utils/LoggerUtils";

/**
 * Manages peer-to-peer communication and state machines
 * Also serves as the implementation of AStateMachine
 */
class EvmDiamondStateMachine extends ADiamondStateMachine {
    readonly contractExecutor: AContractExecutor;
    readonly contractInterface: ethers.Interface;
    private readonly stateMachineAddress: Address;
    private p2pContractInstance?: AStateMachineContract;
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

    public setP2pContractInstance<T extends AStateMachineContract>(
        p2pContractInstance: T
    ) {
        this.p2pContractInstance = p2pContractInstance;
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
            try {
                const event = this.contractInterface.parseLog(log);
                if (event && this.p2pContractInstance) {
                    this.p2pContractInstance.emit(
                        event.name,
                        ...Object.values(event.args)
                    );
                }
            } catch {
                // Unknown log event - ignore silently
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
    public static async createStandalone(
        deployStateMachine: LocalStateMachineDeployer,
        contractInterface: ethers.Interface,
        signer: Signer,
        timeConfig: TimeConfig,
        logger: Logger,
        disputeExecutionGasLimit: number,
        vmDedicatedThread: boolean,
        customPrecompiles?: EvmCustomPrecompileManifest[]
    ): Promise<{
        evmDiamondStateMachine: EvmDiamondStateMachine;
        deploymentResult: DeploymentResult;
    }> {
        const contractExecutor = await createContractExecutorFactory({
            dedicatedThread: vmDedicatedThread,
            customPrecompiles,
            logger
        });

        const localSigner = new LocalDiamondSigner(signer, contractExecutor);

        const stateMachineAddress = await deployStateMachine(localSigner);

        const diamondResult = await deployLocalDiamond(
            deployStateMachine,
            localSigner,
            timeConfig,
            disputeExecutionGasLimit
        );

        // Create LocalDiamond contract instance
        const localDiamondContract = new ethers.Contract(
            diamondResult.address.toString(),
            LocalDiamondArtifact.abi,
            localSigner
        ) as unknown as LocalDiamond;

        // Wrap with staticCall proxy to auto-convert Result objects
        const proxiedLocalDiamond =
            createEthersResultProxy(localDiamondContract);

        return {
            evmDiamondStateMachine: new EvmDiamondStateMachine(
                contractExecutor,
                stateMachineAddress,
                contractInterface,
                proxiedLocalDiamond
            ),
            deploymentResult: diamondResult
        };
    }

    /**
     * Sets up a P2P interaction environment with the state machine
     * @param signer The signer to use for transactions
     * @param deployedStateChannelContractInstance The deployed state channel manager proxy
     * @param stateMachineContractInstance The state machine contract instance
     * @param deployStateMachine A deployer that creates local state machine instances
     * @param p2pEventHooks Optional event hooks for P2P interactions
     * @param timeConfigOverride Optional time configuration override for testing
     * @returns Promise with the created P2P interaction object
     */
    public static async p2pSetup<
        T extends AStateMachineContract,
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        TFactories extends RpcServiceFactoryMap = {}
    >(
        signer: Signer,
        deployedStateChannelContractInstance: StateChannelManagerProxy,
        stateMachineContractInstance: T,
        deployStateMachine: LocalStateMachineDeployer,
        options?: {
            p2pEventHooks?: P2pEventHooks;
            peerId?: number;
            peerLogger?: Logger;
            rpcServiceFactories?: TFactories;
            config?: Partial<Config>;
            customPrecompiles?: EvmCustomPrecompileManifest[];
        }
    ): Promise<P2pInstance<T, TFactories>> {
        // Initialize SDK config for this runtime (intended to be called once).
        const activeConfig = createConfig(options?.config);

        const p2pEventHooks = options?.p2pEventHooks;
        const pid = options?.peerId;
        const peerLogger = options?.peerLogger;
        const rpcServiceFactories = options?.rpcServiceFactories;
        const customPrecompiles = options?.customPrecompiles;

        // Resolve signer address early for logger context
        const signerAddress = await signer.getAddress();

        const logger =
            peerLogger ||
            createLogger(
                {
                    peerId: pid,
                    peerAddress: signerAddress
                },
                { component: "ClientApp" },
                { attachErrorListener: true }
            );

        // Sync clock to DLT
        await Clock.init(signer.provider!);

        // Connect signer to state channel contract
        deployedStateChannelContractInstance =
            await deployedStateChannelContractInstance.connect(signer);

        // Apply debug proxy if enabled
        if (config.DEBUG_CHANNEL_CONTRACT) {
            deployedStateChannelContractInstance = DebugProxy.createProxy(
                deployedStateChannelContractInstance
            );
        }

        // Get time configuration from SCM proxy
        const configTimes =
            await deployedStateChannelContractInstance.getAllTimes();
        const timeConfig: TimeConfig = {
            p2pTime: Number(configTimes[0]),
            agreementTime: Number(configTimes[1]),
            chainFallbackTime: Number(configTimes[2]),
            evidenceTime: Number(configTimes[3])
        };
        const disputeExecutionGasLimit = Number(
            await deployedStateChannelContractInstance.getGasLimit()
        );
        await LoggerUtils.logTimestamp(logger, "info", timeConfig);

        // Create the EvmStateMachine instance (which extends AStateMachine)
        // Pass the SCM contract so local diamond can sync its time config
        const { evmDiamondStateMachine } =
            await EvmDiamondStateMachine.createStandalone(
                deployStateMachine,
                stateMachineContractInstance.interface,
                signer,
                timeConfig,
                logger,
                disputeExecutionGasLimit,
                activeConfig.VM_DEDICATED_THREAD,
                customPrecompiles
            );

        const storage = new Storage();

        const stateManager = new StateManager(
            signer,
            signerAddress,
            deployedStateChannelContractInstance,
            evmDiamondStateMachine,
            timeConfig,
            p2pEventHooks || {},
            storage,
            logger,
            rpcServiceFactories
        );

        // Set state manager on P2P communication manager
        evmDiamondStateMachine.setStateManager(stateManager);

        // Create P2P contract instance
        const p2pContractInstance = stateMachineContractInstance.connect(
            stateManager.p2pManager.p2pSigner
        ) as T;

        // Set P2P contract instance on P2P manager
        evmDiamondStateMachine.setP2pContractInstance(p2pContractInstance);

        const typedP2pSigner = stateManager.p2pManager
            .p2pSigner as unknown as P2pSigner<TFactories>;

        return new P2pInstance<T, TFactories>(
            p2pContractInstance,
            typedP2pSigner,
            logger
        );
    }
}

export default EvmDiamondStateMachine;
