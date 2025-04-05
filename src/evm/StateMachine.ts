import { ethers, BytesLike, hexlify } from "ethers";
import { TransactionStruct } from "@typechain-types/contracts/V1/DataTypes";
import { ContractExecuter } from "./ContractExecuter";
import { EVM, Log } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util"
/**
 * Provides a typed interface to interact with a state machine contract
 * running in an EVM environment
 */
export class StateMachine {
    readonly contractExecuter: ContractExecuter;
    readonly contractInterface: ethers.Interface;


    /**
     * Creates a new StateMachine instance
     * @param contractExecuter The contract executer
     * @param contractInterface The contract interface
     */
    constructor(
        contractExecuter: ContractExecuter,
        contractInterface: ethers.Interface
    ) {
        this.contractExecuter = contractExecuter;
        this.contractInterface = contractInterface;
    }

    private callData(functionName: string, args: any[] = []): Uint8Array {
        return ethers.getBytes(this.contractInterface.encodeFunctionData(functionName, args));
    }

    /**
 * Creates a standardized error with context information
 * @param methodName The name of the method where the error occurred
 * @param error The original error
 * @returns A new Error with standardized format
 */
    private createContextError(methodName: string, error: unknown): Error {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return new Error(`StateMachineInterface.${methodName}: ${errorMessage}`);
    }


    /**
     * Executes a state transition in the state machine
     * @param tx Transaction data for the state transition
     * @returns Promise with the success status of the operation
     */
    async stateTransition(tx: TransactionStruct): Promise<{ success: boolean, logs: Log[] }> {
        const encodedData = this.callData("stateTransition", [tx]);

        try {
            const result = await this.contractExecuter.executeCall(encodedData);
            return { success: true, logs: result.logs as Log[] };
        } catch (error) {
            return { success: false, logs: [] };
        }
    }

    /**
     * Executes a view function call on the state machine
     * @param functionName The name of the function to call
     * @param args The arguments to pass to the function
     * @returns Promise with the result of the function call
     */
    async runView(tx: ethers.TransactionRequest): Promise<string> {
        try {
            const result = await this.contractExecuter.executeCall(tx.data as BytesLike);
            return hexlify(result.returnValue);
        } catch (error) {
            throw this.createContextError("runView", error);
        }
    }

    /**
     * Gets the list of participants from the state machine
     * @returns Promise with array of participant addresses
     */
    async getParticipants(): Promise<string[]> {
        const callData = this.callData("getParticipants");

        let result = await this.contractExecuter.executeCall(callData);
        const hexResult = ethers.hexlify(result.returnValue);
        const [addresses] = ethers.AbiCoder.defaultAbiCoder().decode(
            ["address[]"],
            hexResult
        );
        return addresses.toArray();
    }


    /**
     * Gets the address of the next participant who should write to the state
     * @returns Promise with the address of the next writer
     */
    async getNextToWrite(): Promise<string> {
        const callData = this.callData("getNextToWrite");
        try {
            let result = await this.contractExecuter.executeCall(callData);
            const hexResult = ethers.hexlify(result.returnValue);
            const [address] = ethers.AbiCoder.defaultAbiCoder().decode(
                ["address"],
                hexResult
            );
            return address;
        } catch (error) {
            throw this.createContextError("getNextToWrite", error);
        }
    }

    /**
     * Updates the serialized state in the state machine
     * @param serializedState The new state to set
     * @returns Promise indicating success
     */
    async setState(serializedState: BytesLike): Promise<boolean> {
        const encodedData = this.callData("setState", [serializedState]);

        try {
            await this.contractExecuter.executeCall(encodedData);
            return true;
        } catch (error) {
            throw this.createContextError("setState", error);
        }
    }

    /**
     * Retrieves the current serialized state from the state machine
     * @returns Promise with the current state as a string
     */
    async getState(): Promise<string> {
        const callData = this.callData("getState");

        try {
            let result = await this.contractExecuter.executeCall(callData);
            const hexResult = ethers.hexlify(result.returnValue);
            const [encodedBytes] = ethers.AbiCoder.defaultAbiCoder().decode(
                ["bytes"],
                hexResult
            );
            return encodedBytes;
        } catch (error) {
            throw this.createContextError("getState", error);
        }
    }



    /**
     * Creates a new StateMachineInterface with its own EVM execution environment
     * @param evm The EVM instance
     * @param contractAddress The address of the deployed contract
     * @param contractInterface The interface of the contract
     * @returns A new StateMachineInterface instance
     */
    public static create(
        evm: EVM,
        contractAddress: Address,
        contractInterface: ethers.Interface
    ): StateMachine {
        const contractExecuter = new ContractExecuter(evm, contractAddress);
        return new StateMachine(contractExecuter, contractInterface);
    }
} 