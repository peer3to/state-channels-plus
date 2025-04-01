import AStateMachine from "@/AStateMachine";
import { EVM } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { BytesLike, ethers, Signer } from "ethers";
import { AStateChannelManagerProxy, AStateMachine as AStateMachineContract } from "@typechain-types";
import { TransactionStruct } from "@typechain-types/contracts/V1/DataTypes";
import P2pSigner from "./P2pSigner";
import StateManager from "@/StateManager";
import Clock from "@/Clock";
import { TimeConfig } from "@/DataTypes";
import DebugProxy from "@/utils/DebugProxy";
import P2pEventHooks from "@/P2pEventHooks";

let DEBUG_CHANNEL_CONTRACT = true;

type ParsedLog = {
    topics: string[];
    data: string;
};
export class P2pInteraction<T extends AStateMachineContract> {
    p2pContractInstance: T;
    p2pSigner: P2pSigner;

    constructor(p2pContractInstance: T, p2pSigner: P2pSigner) {
        this.p2pContractInstance = p2pContractInstance;
        this.p2pSigner = p2pSigner;
    }

    public async dispose() {
        this.p2pContractInstance.removeAllListeners();
        await this.p2pSigner.p2pManager.stateManager.dispose();
    }

    public setHooks(p2pEventHooks: P2pEventHooks) {
        this.p2pSigner.p2pManager.stateManager.setP2pEventHooks(p2pEventHooks);
    }
}

class EvmStateMachine extends AStateMachine {
    evm: EVM;
    stateMachineAddress: Address;
    stateMachineInterface: ethers.Interface;
    p2pContractInstance: AStateMachineContract | undefined;
    private constructor(
        evm: EVM,
        stateMachineAddress: Address,
        stateMachineInterface: ethers.Interface
    ) {
        super();
        this.evm = evm;
        this.stateMachineAddress = stateMachineAddress;
        this.stateMachineInterface = stateMachineInterface;
    }

    public async stateTransition(tx: TransactionStruct) {
        let encodedData = this.stateMachineInterface.encodeFunctionData(
            "stateTransition",
            [tx]
        );
        let result = await this.evm.runCall({
            data: ethers.getBytes(encodedData),
            to: this.stateMachineAddress
        });
        if (result.execResult.exceptionError) {
            console.log(
                "EvmStateMachine - stateTransition - exceptionError",
                result
            );
            let hex = ethers.hexlify(result.execResult.returnValue);
            hex = "0x" + hex.slice(2 + 8); //'0x' + 4bytes
            console.log("Hex:", hex);
            let decodedString = ethers.AbiCoder.defaultAbiCoder().decode(
                ["string"],
                hex
            );
            console.log("Decoded string:", decodedString);
            return { success: false, successCallback: () => { } };
        }

        //Process logs
        const processLogs = () => {
            if (result.execResult.logs) {
                for (let i = 0; i < result.execResult.logs.length; i++) {
                    this.processEvmLog(result.execResult.logs[i]);
                }
            }
        };
        // setTimeout(processLogs, 0); // put it at the end of the event queue (loop) - allowing the logic context to finish - preventing race condition by updating the agreementManager before proceeding with subsequent triggers
        return { success: true, successCallback: processLogs };
    }
    public async runView(tx: ethers.TransactionRequest): Promise<any> {
        let result = await this.evm.runCall({
            data: ethers.getBytes(tx.data as BytesLike),
            to: this.stateMachineAddress
        });
        if (result.execResult.exceptionError)
            throw new Error("EvmStateMachine - runCall - exceptionError");
        return ethers.hexlify(result.execResult.returnValue);
    }
    public async getParticipants(): Promise<string[]> {
        let result = await this.evm.runCall({
            data: ethers.getBytes(
                this.stateMachineInterface.encodeFunctionData("getParticipants")
            ),
            to: this.stateMachineAddress
        });
        if (result.execResult.exceptionError)
            throw new Error(
                "EvmStateMachine - getParticipants - exceptionError"
            );
        let hexResult = ethers.hexlify(result.execResult.returnValue);
        let addresses = ethers.AbiCoder.defaultAbiCoder().decode(
            ["address[]"],
            hexResult
        );
        return addresses[0].toArray();
    }

    public async getNextToWrite(): Promise<string> {
        let result = await this.evm.runCall({
            data: ethers.getBytes(
                this.stateMachineInterface.encodeFunctionData("getNextToWrite")
            ),
            to: this.stateMachineAddress
        });
        if (result.execResult.exceptionError)
            throw new Error(
                "EvmStateMachine - getNextToWrite - exceptionError"
            );
        let hexResult = ethers.hexlify(result.execResult.returnValue);
        let address = ethers.AbiCoder.defaultAbiCoder().decode(
            ["address"],
            hexResult
        );
        return address[0];
    }

    public async setState(serializedState: any): Promise<void> {
        let result = await this.evm.runCall({
            data: ethers.getBytes(
                this.stateMachineInterface.encodeFunctionData("setState", [
                    serializedState
                ])
            ),
            to: this.stateMachineAddress
        });
        if (result.execResult.exceptionError)
            throw new Error("EvmStateMachine - setState - exceptionError");
        //TODO!
    }

    public async getState(): Promise<string> {
        let result = await this.evm.runCall({
            data: ethers.getBytes(
                this.stateMachineInterface.encodeFunctionData("getState")
            ),
            to: this.stateMachineAddress
        });
        if (result.execResult.exceptionError)
            throw new Error("EvmStateMachine - getState - exceptionError");
        let hexResult = ethers.hexlify(result.execResult.returnValue);
        let encodedBytes = ethers.AbiCoder.defaultAbiCoder().decode(
            ["bytes"],
            hexResult
        );
        return encodedBytes[0];
    }
    public setP2pContractInstance<T extends AStateMachineContract>(
        p2pContractInstance: T
    ) {
        this.p2pContractInstance = p2pContractInstance;
    }
    private processEvmLog(evmLogOutput: any[]) {
        let topics = evmLogOutput[1].map((topic: any) => ethers.hexlify(topic));
        let data = ethers.hexlify(evmLogOutput[2]);
        let parsedLog: ParsedLog = { topics, data };
        let event = this.stateMachineInterface.parseLog(parsedLog);
        try {
            this.p2pContractInstance?.emit(
                event!.name,
                ...Object.values(event!.args)
            );
        } catch (e) { }
    }

    public static async createStandalone(
        deployStateMachineTx: any,
        stateMachineInterface: ethers.Interface
    ): Promise<EvmStateMachine> {
        let evm = await EVM.create();
        const deploymentResult = await evm.runCall({
            data: ethers.getBytes(deployStateMachineTx.data)
        });
        if (!deploymentResult.createdAddress)
            throw new Error(
                "EvmStateMachine - create - deploymentTx didn't deploy a contract"
            );
        return new EvmStateMachine(
            evm,
            deploymentResult.createdAddress,
            stateMachineInterface
        );
    }
    public static async p2pSetup<T extends AStateMachineContract>(
        signer: Signer,
        deployStateMachineTx: any,
        deployedStateChannelContractInstance: AStateChannelManagerProxy,
        stateMachineContractInstance: T,
        p2pEventHooks?: P2pEventHooks
    ): Promise<P2pInteraction<T>> {
        //Sync clock to DLT
        await Clock.init(signer.provider!);

        deployedStateChannelContractInstance =
            deployedStateChannelContractInstance.connect(signer);
        if (DEBUG_CHANNEL_CONTRACT)
            deployedStateChannelContractInstance = DebugProxy.createProxy(
                deployedStateChannelContractInstance
            );

        let evmStateMachine = await EvmStateMachine.createStandalone(
            deployStateMachineTx,
            stateMachineContractInstance.interface
        );

        let configTimes =
            await deployedStateChannelContractInstance.getAllTimes();
        let timeConfig: TimeConfig = {
            p2pTime: Number(configTimes[0]),
            agreementTime: Number(configTimes[1]),
            chainFallbackTime: Number(configTimes[2]),
            challengeTime: Number(configTimes[3])
        };

        let signerAddress = await signer.getAddress();

        let stateManager = new StateManager(
            signer,
            signerAddress,
            deployedStateChannelContractInstance,
            evmStateMachine,
            timeConfig,
            p2pEventHooks || {}
        );
        let p2pContractInstance = stateMachineContractInstance.connect(
            stateManager.p2pManager.p2pSigner
        ) as T;
        evmStateMachine.setP2pContractInstance(p2pContractInstance);
        return new P2pInteraction(
            p2pContractInstance,
            stateManager.p2pManager.p2pSigner
        );
    }
}

export default EvmStateMachine;
