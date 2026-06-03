import { ethers, Signer, TransactionResponse } from "ethers";

import {
    TransactionStruct,
    JoinChannelConfirmationStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import type P2PManager from "@/P2PManager";
import MainRpcService from "@/rpc/MainRpcService";
import { Address, Bytes } from "@/types/types";
import { Status } from "@/types";
import { Logger } from "..";

class P2pSigner<TCustomRpc extends MainRpcService = MainRpcService>
    implements Signer
{
    signer: Signer;
    signerAddress: Address;
    provider: ethers.Provider | null;
    p2pManager: P2PManager<TCustomRpc>;
    logger: Logger;
    //local profile
    isLeader: boolean;

    constructor(
        signer: Signer,
        signerAddress: Address,
        p2pManager: P2PManager<TCustomRpc>
    ) {
        this.signer = signer;
        this.signerAddress = signerAddress;
        this.provider = signer.provider;
        this.p2pManager = p2pManager;
        this.isLeader = false;
        this.logger = p2pManager.logger.child({ component: "P2pSigner" });
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

        this.logger.debug(
            `Sending transaction #${Number(_tx.header.transactionCnt)} timestamp: ${Number(_tx.header.timestamp)}`
        );
        const _blockConfirmation =
            await this.p2pManager.stateManager.playTransaction(_tx);
        // NOTE: playTransaction already broadcasts via success() method, no need to broadcast again here

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

    async setChannelId(channelId: Bytes): Promise<void> {
        await this.p2pManager.stateManager.setChannelId(channelId);
    }

    public setIsLeader(value: boolean) {
        this.isLeader = value;
    }

    public getIsLeader() {
        return this.isLeader;
    }

    public async connectToChannel(channelId: Bytes) {
        await this.setChannelId(channelId);

        // Update status to NOT_OPENED/OPENED as soon as we know the channelId.
        await this.p2pManager.stateManager.refreshOpenedStatusFromChain();

        return this.p2pManager.tryOpenConnectionToChannel(channelId.toString());
    }

    public async joinChannel(
        confirmation: JoinChannelConfirmationStruct
    ): Promise<void> {
        return this.p2pManager.stateManager.joinChannel(confirmation);
    }

    public disconnectFromPeers() {
        this.p2pManager.disconnectAll();
    }

    public getChannelStatus(): Promise<Status> {
        return this.p2pManager.stateManager.getChannelStatus();
    }
}

export default P2pSigner;
