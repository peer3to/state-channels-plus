import { ethers, Signer, TransactionResponse } from "ethers";

import {
    JoinChannelStruct,
    SignedBlockStruct,
    SignedJoinChannelStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import Clock from "@/Clock";
import { Codec, SignatureUtils, Type } from "@/utils";
import { Block } from "@/models";
import { Address, Amount, Bytes, Timestamp } from "@/types/types";
import { SignedDisputeStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";
import { inject, ServiceNames } from "@/container";

class P2pSigner implements Signer {
    signer: Signer;
    signerAddress: Address;
    provider: ethers.Provider | null;

    //local profile
    isLeader: boolean;

    //TODO! TEST
    jc: JoinChannelStruct | undefined;
    signedJc: any;
    setJc(jc: JoinChannelStruct, signedJc: any) {
        this.jc = jc;
        this.signedJc = signedJc;
    }

    constructor(signer: Signer, signerAddress: Address) {
        this.signer = signer;
        this.signerAddress = signerAddress;
        this.provider = signer.provider;
        this.isLeader = false;
    }

    private get stateManager() {
        return inject(ServiceNames.STATE_MANAGER);
    }

    private get agreementManager() {
        return inject(ServiceNames.AGREEMENT_MANAGER);
    }

    private get p2pManager() {
        return inject(ServiceNames.P2P_MANAGER);
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
        return await this.stateManager.stateMachine.runView(tx);
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
        let _tx: TransactionStruct = {
            header: {
                channelId: this.stateManager.getChannelId(),
                participant: this.stateManager.getSignerAddress(),
                forkId: this.stateManager.getforkId(),
                transactionCnt: this.stateManager.getNextBlockHeight(),
                timestamp: BigInt(Clock.getTimeInSeconds())
            },
            body: {
                encodedData: tx.data!,
                data: tx.data!
            }
        };

        let signedBlock = await this.stateManager.playTransaction(_tx);
        this.p2pManager.rpcProxy.onSignedBlock(signedBlock).broadcast();
        return "There is no TransactionResponse p2p - everything executed localy" as unknown as TransactionResponse; //TODO
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
        this.stateManager.setChannelId(channelId);
    }
    public async confirmBlock(signedBlock: SignedBlockStruct) {
        let block = Block.decode(signedBlock.encodedBlock);
        let signature = await block.sign(this.signer);
        this.agreementManager.confirmBlock(block, signature);
        this.p2pManager.rpcProxy
            .onBlockConfirmation(signedBlock, signature)
            .broadcast();
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

    public async confirmDispute(dispute: DisputeStruct) {
        // Add our signature
        const { encoded, signature } = await SignatureUtils.signDispute(
            dispute,
            this.signer
        );
        const signedDispute = {
            encodedDispute: encoded,
            signature
        } as SignedDisputeStruct;

        // Store signature in AgreementManager
        this.agreementManager.confirmDispute(dispute, signature);

        // Broadcast confirmation with our signature
        this.p2pManager.rpcProxy
            .onDisputeConfirmation(signedDispute)
            .broadcast();
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
        this.p2pManager.rpcProxy
            .onJoinChannelRequest(signedJoinChannel)
            .broadcast();
    }
}

export default P2pSigner;
