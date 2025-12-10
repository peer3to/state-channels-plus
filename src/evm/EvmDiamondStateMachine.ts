import { EVM } from "@ethereumjs/evm";
import { ethers, Signer, hexlify, ContractDeployTransaction } from "ethers";
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
    decodeErrorProxy,
    Codec,
    createLogger,
    Logger,
    createEthersResultProxy
} from "@/utils";
import P2pEventHooks from "@/P2pEventHooks";
import ADiamondStateMachine from "@/ADiamondStateMachine";
import { P2pInstance, ContractExecuter } from "@/evm";
import { Address, Bytes } from "@/types/types";
import {
    BalanceStruct,
    MessageStruct
} from "@typechain-types/contracts/V1/AStateMachine";
import Storage from "@/storage";
import {
    deployLocalDiamond,
    deployLocalFromTx,
    DeploymentResult
} from "scripts/V1/deploy";
import LocalDiamondSigner from "./LocalDiamondSigner";
import { LocalDiamondArtifact } from "@/utils/GeneratedArtifacts";

import { DEBUG_CHANNEL_CONTRACT } from "@/utils/config";

/**
 * Manages peer-to-peer communication and state machines
 * Also serves as the implementation of AStateMachine
 */
class EvmDiamondStateMachine extends ADiamondStateMachine {
    readonly stateMachineContractExecuter: ContractExecuter;
    readonly diamondContractExecuter: ContractExecuter;
    readonly contractInterface: ethers.Interface;
    private p2pContractInstance?: AStateMachineContract;
    public stateManager?: StateManager;

    constructor(
        stateMachineContractExecuter: ContractExecuter,
        contractInterface: ethers.Interface,
        diamondContractExecuter: ContractExecuter,
        localDiamondContract: LocalDiamond
    ) {
        super(localDiamondContract);
        this.stateMachineContractExecuter = stateMachineContractExecuter;
        this.contractInterface = contractInterface;
        this.diamondContractExecuter = diamondContractExecuter;
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

    /**
     * Process logs from an EVM call and emit corresponding events
     * @param logs The log output from the EVM
     */
    public processLogs(logs?: any[]): void {
        if (!logs || logs.length === 0) return;

        for (const log of logs) {
            const topics = log[1].map((topic: any) => hexlify(topic));
            const data = hexlify(log[2]);
            const parsedLog = { topics, data };

            try {
                const event = this.contractInterface.parseLog(parsedLog);
                if (event && this.p2pContractInstance) {
                    this.p2pContractInstance.emit(
                        event.name,
                        ...Object.values(event.args)
                    );
                }
            } catch (e) {
                console.error("Error parsing log", e);
            }
        }
    }

    async stateTransition(tx: TransactionStruct) {
        const encodedData = this.getEncodedCalldata("stateTransition", [tx]);

        try {
            const result =
                await this.stateMachineContractExecuter.executeCall(
                    encodedData
                );
            // Decode the return values: (bool success, Message[] outboundMessages)
            const hexResult = hexlify(result.returnValue);
            const [success, outboundMessages] =
                ethers.AbiCoder.defaultAbiCoder().decode(
                    ["bool", `${MessageEthersType}[]`],
                    hexResult
                );
            return {
                success: true,
                successCallback: () => this.processLogs(result.logs),
                outboundMessages: outboundMessages as MessageStruct[]
            };
        } catch (error) {
            return {
                success: false,
                successCallback: () => {},
                outboundMessages: []
            };
        }
    }

    async runView(tx: ethers.TransactionRequest): Promise<string> {
        try {
            const result = await this.stateMachineContractExecuter.executeCall(
                tx.data as Bytes
            );
            return hexlify(result.returnValue);
        } catch (error) {
            throw this.createContextError("runView", error);
        }
    }

    async getParticipants(): Promise<Address[]> {
        const callData = this.getEncodedCalldata("getParticipants");

        const addresses = Codec.decodeEvmResult<Address[]>(
            await this.stateMachineContractExecuter.executeCall(callData),
            "address[]"
        );
        return addresses;
    }

    async getNextToWrite(): Promise<Address> {
        const callData = this.getEncodedCalldata("getNextToWrite");
        try {
            return Codec.decodeEvmResult<Address>(
                await this.stateMachineContractExecuter.executeCall(callData),
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
            await this.stateMachineContractExecuter.executeCall(encodedData);
            return true;
        } catch (error) {
            throw this.createContextError("setState", error);
        }
    }

    async getState(): Promise<Bytes> {
        const callData = this.getEncodedCalldata("getState");

        try {
            return Codec.decodeEvmResult<Bytes>(
                await this.stateMachineContractExecuter.executeCall(callData),
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
                await this.stateMachineContractExecuter.executeCall(callData),
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
                await this.stateMachineContractExecuter.executeCall(callData),
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
                await this.stateMachineContractExecuter.executeCall(callData),
                BalanceEthersType
            );
        } catch (error) {
            throw this.createContextError("subtractBalance", error);
        }
    }

    async processInboundMessage(message: MessageStruct): Promise<boolean> {
        const callData = this.getEncodedCalldata("processInboundMessage", [
            message
        ]);

        try {
            const result =
                await this.stateMachineContractExecuter.executeCall(callData);
            const hexResult = hexlify(result.returnValue);
            const [success] = ethers.AbiCoder.defaultAbiCoder().decode(
                ["bool"],
                hexResult
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
                await this.stateMachineContractExecuter.executeCall(callData),
                BalanceEthersType,
                { useObjectConversion: true }
            );
        } catch (error) {
            throw this.createContextError("getTotalStateBalance", error);
        }
    }

    /**
     * Creates a standalone EVM state machine
     * @param deployStateMachineTx The transaction to deploy the state machine
     * @param contractInterface The interface of the state machine contract
     * @returns A new EvmStateMachine instance
     */
    public static async createStandalone(
        deployStateMachineTx: ContractDeployTransaction,
        contractInterface: ethers.Interface,
        signer: Signer,
        timeConfig: TimeConfig
    ): Promise<{
        evmDiamondStateMachine: EvmDiamondStateMachine;
        deploymentResult: DeploymentResult;
    }> {
        // since this is local deployment, we can allow unlimited contract size
        const evm = await EVM.create({ allowUnlimitedContractSize: true });

        const stateMachineAddress = await deployLocalFromTx(
            deployStateMachineTx,
            evm
        );

        const diamondResult = await deployLocalDiamond(
            deployStateMachineTx,
            evm,
            signer,
            timeConfig
        );

        const diamondExecuter = new ContractExecuter(
            evm,
            diamondResult.address
        );
        const localDiamondSigner = new LocalDiamondSigner(
            signer,
            diamondExecuter
        );

        // Create LocalDiamond contract instance
        const localDiamondContract = new ethers.Contract(
            localDiamondSigner.getDiamondAddress(),
            LocalDiamondArtifact.abi,
            localDiamondSigner
        ) as unknown as LocalDiamond;

        // Wrap with staticCall proxy to auto-convert Result objects
        const proxiedLocalDiamond =
            createEthersResultProxy(localDiamondContract);

        return {
            evmDiamondStateMachine: new EvmDiamondStateMachine(
                new ContractExecuter(evm, stateMachineAddress),
                contractInterface,
                diamondExecuter,
                proxiedLocalDiamond
            ),
            deploymentResult: diamondResult
        };
    }

    /**
     * Sets up a P2P interaction environment with the state machine
     * @param signer The signer to use for transactions
     * @param deployStateMachineTx Transaction to deploy the state machine
     * @param deployedStateChannelContractInstance The deployed state channel manager proxy
     * @param stateMachineContractInstance The state machine contract instance
     * @param p2pEventHooks Optional event hooks for P2P interactions
     * @param timeConfigOverride Optional time configuration override for testing
     * @returns Promise with the created P2P interaction object
     */
    public static async p2pSetup<T extends AStateMachineContract>(
        signer: Signer,
        deployStateMachineTx: any,
        deployedStateChannelContractInstance: StateChannelManagerProxy,
        stateMachineContractInstance: T,
        p2pEventHooks?: P2pEventHooks,
        peerId?: number,
        peerLogger?: Logger
    ): Promise<P2pInstance<T>> {
        // Sync clock to DLT
        await Clock.init(signer.provider!);
        deployedStateChannelContractInstance = decodeErrorProxy(
            deployedStateChannelContractInstance
        ) as StateChannelManagerProxy;

        // Connect signer to state channel contract
        deployedStateChannelContractInstance =
            await deployedStateChannelContractInstance.connect(signer);

        // Apply debug proxy if enabled

        if (DEBUG_CHANNEL_CONTRACT) {
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

        // Create the EvmStateMachine instance (which extends AStateMachine)
        // Pass the SCM contract so local diamond can sync its time config
        const { evmDiamondStateMachine } =
            await EvmDiamondStateMachine.createStandalone(
                deployStateMachineTx,
                stateMachineContractInstance.interface,
                signer,
                timeConfig
            );

        const signerAddress = await signer.getAddress();
        const storage = new Storage();

        const logger =
            peerLogger ||
            createLogger({
                peerId,
                peerAddress: signerAddress
            });

        const stateManager = new StateManager(
            signer,
            signerAddress,
            deployedStateChannelContractInstance,
            evmDiamondStateMachine,
            timeConfig,
            p2pEventHooks || {},
            storage,
            logger
        );

        // Set state manager on P2P communication manager
        evmDiamondStateMachine.setStateManager(stateManager);

        // Create P2P contract instance
        const p2pContractInstance = stateMachineContractInstance.connect(
            stateManager.p2pManager.p2pSigner
        ) as T;

        // Set P2P contract instance on P2P manager
        evmDiamondStateMachine.setP2pContractInstance(p2pContractInstance);

        return new P2pInstance(
            p2pContractInstance,
            stateManager.p2pManager.p2pSigner
        );
    }
}

export default EvmDiamondStateMachine;
