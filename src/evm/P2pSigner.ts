import {
    AddressLike,
    BytesLike,
    ethers,
    SignatureLike,
    Signer,
    TransactionResponse
} from "ethers";

import {
    JoinChannelStruct,
    SignedBlockStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/DataTypes";
import Clock from "@/Clock";
import P2PManager from "@/P2PManager";
import { EvmUtils } from "@/utils";
class P2pSigner implements Signer {
    signer: Signer;
    signerAddress: AddressLike;
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
        signerAddress: AddressLike,
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
        return await this.p2pManager.stateManager.stateMachine.runView(tx);
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
                channelId: this.p2pManager.stateManager.getChannelId(),
                participant: this.p2pManager.stateManager.getSignerAddress(),
                forkCnt: this.p2pManager.stateManager.getForkCnt(),
                transactionCnt:
                    this.p2pManager.stateManager.getNextBlockHeight(),
                timestamp: BigInt(Clock.getTimeInSeconds())
            },
            body: {
                transactionType: 0,
                encodedData: tx.data!,
                data: tx.data!
            }
        };

        let signedBlock =
            await this.p2pManager.stateManager.playTransaction(_tx);
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

    setChannelId(channelId: BytesLike) {
        this.p2pManager.stateManager.setChannelId(channelId);
    }
    public async confirmBlock(signedBlock: SignedBlockStruct) {
        let block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        let confirmedBlock = await EvmUtils.signBlock(block, this.signer);
        this.p2pManager.stateManager.agreementManager.confirmBlock(
            block,
            confirmedBlock.signature as SignatureLike
        );
        this.p2pManager.rpcProxy
            .onBlockConfirmation(signedBlock, confirmedBlock.signature)
            .broadcast();
    }

    public setIsLeader(value: boolean) {
        this.isLeader = value;
    }

    public getIsLeader() {
        return this.isLeader;
    }

    public async connectToChannel(channelId: ethers.BytesLike) {
        this.setChannelId(channelId);
        await this.p2pManager.tryOpenConnectionToChannel(channelId.toString());
    }

    public disconnectFromPeers() {
        this.p2pManager.disconnectAll();
    }
}

export default P2pSigner;
