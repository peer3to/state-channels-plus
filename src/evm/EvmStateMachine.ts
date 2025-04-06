import { EVM } from "@ethereumjs/evm";
import { BytesLike, ethers, Signer } from "ethers";
import {
    AStateChannelManagerProxy,
    AStateMachine as AStateMachineContract
} from "@typechain-types";
import { TransactionStruct } from "@typechain-types/contracts/V1/DataTypes";
import StateManager from "@/StateManager";
import Clock from "@/Clock";
import { TimeConfig } from "@/DataTypes";
import DebugProxy from "@/utils/DebugProxy";
import P2pEventHooks from "@/P2pEventHooks";
import { StateMachine } from "./StateMachine";
import AStateMachine from "@/AStateMachine";
import { P2pInteraction } from "./P2pInteraction";

const DEBUG_CHANNEL_CONTRACT = true;

/**
 * Manages peer-to-peer communication and state machines
 * Also serves as the implementation of AStateMachine
 */
class EvmStateMachine extends AStateMachine {
    readonly stateMachineInterface: StateMachine;
    readonly contractInterface: ethers.Interface;
    private p2pContractInstance?: AStateMachineContract;
    public stateManager?: StateManager;

    constructor(
        stateMachineInterface: StateMachine,
        contractInterface: ethers.Interface
    ) {
        super();
        this.stateMachineInterface = stateMachineInterface;
        this.contractInterface = contractInterface;
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
            const topics = log[1].map((topic: any) => ethers.hexlify(topic));
            const data = ethers.hexlify(log[2]);
            const parsedLog = { topics, data };

            try {
                const event = this.contractInterface.parseLog(parsedLog);
                if (event && this.p2pContractInstance) {
                    this.p2pContractInstance.emit(
                        event.name,
                        ...Object.values(event.args)
                    );
                }
            } catch (e) { }
        }
    }

    public async stateTransition(tx: TransactionStruct) {
        const result = await this.stateMachineInterface.stateTransition(tx);
        return {
            success: result.success,
            successCallback: result.success ? () => this.processLogs(result.logs) : () => { }
        };
    }

    public async runView(tx: ethers.TransactionRequest): Promise<string> {
        return this.stateMachineInterface.runView(tx);
    }

    public async getParticipants(): Promise<string[]> {
        return this.stateMachineInterface.getParticipants();
    }

    public async getNextToWrite(): Promise<string> {
        return this.stateMachineInterface.getNextToWrite();
    }

    public async setState(serializedState: BytesLike): Promise<boolean> {
        return this.stateMachineInterface.setState(serializedState);
    }
    public async getState(): Promise<string> {
        return this.stateMachineInterface.getState();
    }

    /**
     * Creates a standalone EVM state machine
     * @param deployStateMachineTx The transaction to deploy the state machine
     * @param contractInterface The interface of the state machine contract
     * @returns A new EvmStateMachine instance
     */
    public static async createStandalone(
        deployStateMachineTx: any,
        contractInterface: ethers.Interface
    ): Promise<EvmStateMachine> {
        const evm = await EVM.create();

        // Deploy the state machine contract
        const deploymentResult = await evm.runCall({
            data: ethers.getBytes(deployStateMachineTx.data)
        });

        if (deploymentResult.execResult.exceptionError) {
            throw new Error("EvmStateMachine - create - deploymentTx failed");
        }

        if (!deploymentResult.createdAddress) {
            throw new Error("EvmStateMachine - create - deploymentTx didn't deploy a contract");
        }

        // Create StateMachine with internal ContractExecuter
        const stateMachine = StateMachine.create(
            evm,
            deploymentResult.createdAddress,
            contractInterface
        );


        return new EvmStateMachine(
            stateMachine,
            contractInterface
        );
    }

    /**
     * Sets up a P2P interaction environment with the state machine
     * @param signer The signer to use for transactions
     * @param deployStateMachineTx Transaction to deploy the state machine
     * @param deployedStateChannelContractInstance The deployed state channel manager proxy
     * @param stateMachineContractInstance The state machine contract instance
     * @param p2pEventHooks Optional event hooks for P2P interactions
     * @returns Promise with the created P2P interaction object
     */
    public static async p2pSetup<T extends AStateMachineContract>(
        signer: Signer,
        deployStateMachineTx: any,
        deployedStateChannelContractInstance: AStateChannelManagerProxy,
        stateMachineContractInstance: T,
        p2pEventHooks?: P2pEventHooks
    ): Promise<P2pInteraction<T>> {
        // Sync clock to DLT
        await Clock.init(signer.provider!);

        // Connect signer to state channel contract
        deployedStateChannelContractInstance = deployedStateChannelContractInstance.connect(signer);

        // Apply debug proxy if enabled

        if (DEBUG_CHANNEL_CONTRACT) {
            deployedStateChannelContractInstance = DebugProxy.createProxy(
                deployedStateChannelContractInstance
            );
        }

        // Create the EvmStateMachine instance (which extends AStateMachine)
        const evmStateMachine = await EvmStateMachine.createStandalone(
            deployStateMachineTx,
            stateMachineContractInstance.interface
        );

        // Get time configuration
        const configTimes = await deployedStateChannelContractInstance.getAllTimes();
        const timeConfig: TimeConfig = {
            p2pTime: Number(configTimes[0]),
            agreementTime: Number(configTimes[1]),
            chainFallbackTime: Number(configTimes[2]),
            challengeTime: Number(configTimes[3])
        };

        const signerAddress = await signer.getAddress();

        // Create state manager with EvmStateMachine (which is an AStateMachine)
        const stateManager = new StateManager(
            signer,
            signerAddress,
            deployedStateChannelContractInstance,
            evmStateMachine,
            timeConfig,
            p2pEventHooks || {}
        );

        // Set state manager on P2P communication manager
        evmStateMachine.setStateManager(stateManager);

        // Create P2P contract instance
        const p2pContractInstance = stateMachineContractInstance.connect(
            stateManager.p2pManager.p2pSigner
        ) as T;

        // Set P2P contract instance on P2P manager
        evmStateMachine.setP2pContractInstance(p2pContractInstance);

        return new P2pInteraction(
            p2pContractInstance,
            stateManager.p2pManager.p2pSigner
        );
    }
}

export default EvmStateMachine;