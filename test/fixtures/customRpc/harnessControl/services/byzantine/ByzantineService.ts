// @spec-test-coverage-ignore: worker-side raw-RPC support for mapped lobby E2E declarations

import ByzantineRpcMethods from "./ByzantineRpcMethods";
import Clock from "@/Clock";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type Rpc from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";
import type { Address, Bytes, ForkId, Hash } from "@/types/types";
import { Codec, getChecksumAddress, Type } from "@/utils";
import type { TransactionStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers } from "ethers";

export type LobbyRawMethod = "advertise" | "pick" | "commit";
export type NegotiationRawMethod = "exchangeTerms" | "openProposal" | "abort";

/**
 * Byzantine block-submission faults exposed to the test harness.
 *
 * Shared state, accessors and helpers live here (not on the RpcMethods class):
 * every method on a `*RpcMethods` instance is routable by name at runtime, so
 * only the public endpoints belong there.
 */
export class ByzantineService extends ANetworkRpcService<ByzantineRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "HarnessByzantineService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }
    get storage() {
        return this.sm.storage;
    }

    /** Head block hash for `forkId`, else the fork's genesis snapshot hash. */
    previousBlockHash(forkId: ForkId): Hash {
        const prevBlock = this.storage.blocks.getLatestBlock(forkId);
        return (prevBlock?.hash ??
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId)
                ?.hash ??
            ethers.ZeroHash) as Hash;
    }

    /** Head block's snapshot hash for `forkId`, else the genesis snapshot hash. */
    stateSnapshotHash(forkId: ForkId): Hash {
        const prevBlock = this.storage.blocks.getLatestBlock(forkId);
        return (prevBlock?.stateSnapshotHash ??
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId)
                ?.hash ??
            ethers.ZeroHash) as Hash;
    }

    /**
     * The next block on this peer's head as its next writer authors it, built
     * by the SDK's own production steps: the real transition of
     * `encodedData`, the pending inbound blocks this peer holds and the
     * production timestamp clamp. Unsigned, never stored: the author signs
     * it. The live state machine is restored afterwards.
     */
    async craftNextBlock(
        encodedData: Bytes
    ): Promise<{ encodedBlock: string; author: Address }> {
        const sm = this.sm;
        const production = sm.blockProductionService;
        return sm.withMutex(
            async () => {
                const forkId = sm.forkId;
                const coordinates = {
                    forkId,
                    height: this.storage.blocks.getNextBlockHeight(forkId)
                };
                const previousStateSnapshot =
                    sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow(
                        coordinates
                    );
                const previousState =
                    this.storage.stateMachineStates.getStateMachineState(
                        previousStateSnapshot.stateMachineStateHash
                    );
                if (previousState === undefined)
                    throw new Error(
                        "craftNextBlock: the head state is missing"
                    );
                const liveState = await sm.diamondStateMachine.getState();
                try {
                    await sm.diamondStateMachine.setState(previousState);
                    const author =
                        await sm.diamondStateMachine.getNextToWrite();
                    const transaction: TransactionStruct = {
                        header: {
                            channelId: sm.channelId,
                            participant: author,
                            forkId,
                            transactionCnt: BigInt(coordinates.height),
                            timestamp: BigInt(Clock.getTimeInSeconds())
                        },
                        body: { encodedData, data: encodedData }
                    };
                    production["adjustTimestampIfNeeded"](transaction);
                    const inboundMessageBlocks = production[
                        "getPendingInboundMessageBlocks"
                    ](previousStateSnapshot);
                    const assembled =
                        await sm.snapshotAssemblyService.assembleFromTransaction(
                            coordinates,
                            transaction,
                            previousStateSnapshot,
                            inboundMessageBlocks,
                            Number(transaction.header.timestamp)
                        );
                    if (!assembled.success)
                        throw new Error(
                            "craftNextBlock: the transaction failed"
                        );
                    const block = await production["createBlock"](
                        transaction,
                        assembled.stateSnapshot.hash,
                        inboundMessageBlocks
                    );
                    return {
                        encodedBlock: Codec.encode(block, Type.Block) as string,
                        author
                    };
                } finally {
                    await sm.diamondStateMachine.setState(liveState);
                }
            },
            { taskName: "byzantine craftNextBlock" }
        );
    }

    public createRPCMethods(transport: NetworkTransport): ByzantineRpcMethods {
        return new ByzantineRpcMethods(transport, this);
    }

    public sendRawRpc(
        targetEvmAddress: string,
        service: "lobbyMatchingService" | "openChannelNegotiationService",
        method: LobbyRawMethod | NegotiationRawMethod,
        params: Rpc["params"]
    ): boolean {
        const transport =
            this.p2pManager.profileManager.getTransportByEvmAddress(
                getChecksumAddress(targetEvmAddress)
            );
        if (!transport) throw new Error("Target peer is not connected");
        transport.send({ service, method, params });
        return true;
    }
}

export default ByzantineService;
