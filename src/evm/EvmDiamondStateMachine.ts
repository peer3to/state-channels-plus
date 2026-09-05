import { ethers, Signer } from "ethers";
import {
    StateChannelManagerInterface,
    AStateMachine as AStateMachineContract
} from "@typechain-types";
import { TransactionStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import StateManager from "../stateManager/StateManager";
import { TimeConfig } from "@/types";
import { BalanceEthersType, MessageEthersType } from "@/types/ethers";
import {
    Codec,
    convertEthersValue,
    createEthersResultProxy,
    connectLocalDiamond,
    type LocalDiamondContract
} from "@/utils";
import ADiamondStateMachine from "@/ADiamondStateMachine";
import P2pInstance from "./P2pInstance";
import {
    setupP2pRuntime,
    type P2pSetupOptions
} from "./p2pRuntime/setupP2pRuntime";
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

import MainRpcService from "@/rpc/MainRpcService";

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
        localDiamondContract: LocalDiamondContract
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

    async isBalanceLesserThan(
        balance1: BalanceStruct,
        balance2: BalanceStruct
    ): Promise<boolean> {
        const callData = this.getEncodedCalldata("isBalanceLesserThan", [
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
            throw this.createContextError("isBalanceLesserThan", error);
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

        const localDiamondContract = connectLocalDiamond(
            diamondResult.address.toString(),
            localSigner
        );

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
        deployedStateChannelContractInstance: StateChannelManagerInterface,
        stateMachineContractInstance: T,
        deployStateMachine: LocalStateMachineDeployer,
        options?: P2pSetupOptions
    ): Promise<P2pInstance<T, TCustomRpc>> {
        // The construction lives in setupP2pRuntime; this public entry passes
        // the production dependencies (platform host and worker).
        return setupP2pRuntime<T, TCustomRpc>(
            deployedStateChannelContractInstance,
            stateMachineContractInstance,
            deployStateMachine,
            options
        );
    }
}

export default EvmDiamondStateMachine;
