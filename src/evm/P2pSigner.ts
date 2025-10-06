import { ethers, Signer, TransactionResponse } from "ethers";

import {
    JoinChannelStruct,
    SignedJoinChannelStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import P2PManager from "@/P2PManager";
import { Codec, Type } from "@/utils";
import { Address, Amount, Bytes, Timestamp } from "@/types/types";

class P2pSigner implements Signer {
    signer: Signer;
    signerAddress: Address;
    provider: ethers.Provider | null;
    p2pManager: P2PManager;

    //local profile
    isLeader: boolean;

    //TODO! TEST
    jc: JoinChannelStruct | undefined;
    signedJc: any;
    setJc(jc: JoinChannelStruct, signedJc: any) {
        this.jc = jc;
        this.signedJc = signedJc;
    }
    constructor(
        signer: Signer,
        signerAddress: Address,
        p2pManager: P2PManager
    ) {
        this.signer = signer;
        this.signerAddress = signerAddress;
        this.provider = signer.provider;
        this.p2pManager = p2pManager;
        this.isLeader = false;
    }

    connect(provider: ethers.Provider | null): Signer {
        return this.signer.connect(provider);
    }

    getAddress(): Promise<string> {
        return this.signer.getAddress();
    }

    getNonce(): Promise<number> {
        return this.signer.getNonce();
    }

    populateCall(
        tx: ethers.TransactionRequest
    ): Promise<ethers.TransactionLike<string>> {
        return this.signer.populateCall(tx);
    }

    populateTransaction(
        tx: ethers.TransactionRequest
    ): Promise<ethers.TransactionLike<string>> {
        return this.signer.populateTransaction(tx);
    }

    estimateGas(tx: ethers.TransactionRequest): Promise<bigint> {
        return this.signer.estimateGas(tx);
    }

    async call(tx: ethers.TransactionRequest): Promise<string> {
        return await this.p2pManager.stateManager.diamondStateMachine.runView(
            tx
        );
    }

    resolveName(name: string): Promise<string | null> {
        return this.signer.resolveName(name);
    }

    signTransaction(tx: ethers.TransactionRequest): Promise<string> {
        return this.signer.signTransaction(tx);
    }

    async sendTransaction(
        tx: ethers.TransactionRequest
    ): Promise<TransactionResponse> {
        const _tx: TransactionStruct = {
            header: {
                channelId: this.p2pManager.stateManager.getChannelId(),
                participant: this.p2pManager.stateManager.getSignerAddress(),
                forkId: this.p2pManager.stateManager.forkId,
                transactionCnt: BigInt(
                    this.p2pManager.stateManager.storage.blocks.getNextBlockHeight(
                        this.p2pManager.stateManager.forkId
                    )
                ),
                timestamp: BigInt(Clock.getTimeInSeconds())
            },
            body: {
                encodedData: tx.data!,
                data: tx.data!
            }
        };

        const blockConfirmation =
            await this.p2pManager.stateManager.playTransaction(_tx);
        this.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(blockConfirmation)
            .broadcast();
        return "There is no TransactionResponse p2p - everything executed locally" as unknown as TransactionResponse; //TODO
    }

    signMessage(message: string | Uint8Array): Promise<string> {
        return this.signer.signMessage(message);
    }

    signTypedData(
        domain: ethers.TypedDataDomain,
        types: Record<string, ethers.TypedDataField[]>,
        value: Record<string, any>
    ): Promise<string> {
        return this.signer.signTypedData(domain, types, value);
    }

    setChannelId(channelId: Bytes) {
        this.p2pManager.stateManager.setChannelId(channelId);
    }

    public setIsLeader(value: boolean) {
        this.isLeader = value;
    }

    public getIsLeader() {
        return this.isLeader;
    }

    public async connectToChannel(channelId: Bytes) {
        this.setChannelId(channelId);
        await this.p2pManager.tryOpenConnectionToChannel(channelId.toString());
    }

    public disconnectFromPeers() {
        this.p2pManager.disconnectAll();
    }

    public async joinChannel(
        channelId: Bytes,
        amount: Amount,
        deadlineTimestamp: Timestamp,
        data: Bytes
    ) {
        const joinChannelRequest: JoinChannelStruct = {
            channelId,
            participant: this.signerAddress,
            balance: {
                amount,
                data
            },
            deadlineTimestamp
        };

        // Encode and sign the request
        const encodedJoinChannel = Codec.encode(
            joinChannelRequest,
            Type.JoinChannel
        );
        const signedJoinChannel: SignedJoinChannelStruct = {
            encodedJoinChannel: encodedJoinChannel,
            signature: await this.signMessage(encodedJoinChannel)
        };

        // Store locally before broadcasting ?

        // Broadcast the request
        this.p2pManager.remoteRpc.joinChannelService
            .onJoinChannelRequest(signedJoinChannel)
            .broadcast();
    }
}

export default P2pSigner;
