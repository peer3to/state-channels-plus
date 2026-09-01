// @spec-test-coverage-ignore: harness network setup exercised by owning mapped test declarations
import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import { DetachedPromises } from "@/utils";
import type { Address, ChannelId } from "@/types/types";
import type { ConnectToChannelOptions } from "@/evm/signer/ConnectToChannelOptions";
import { Codec, Type } from "@/utils";
import type { NetworkService } from "./NetworkService";

export type HarnessConnectToChannelOptions = Omit<
    ConnectToChannelOptions,
    "balance"
> & {
    encodedBalance?: string;
};

/** Connection / network control operations for the test harness. */
export class NetworkRpcMethods extends ARpcMethods {
    constructor(
        transport: ATransport,
        private readonly service: NetworkService
    ) {
        super(transport, service.p2pManager);
    }

    /** Connect this peer to the selected channel. */
    public connectToChannel(
        channelId: string,
        options?: HarnessConnectToChannelOptions
    ): boolean {
        const localOptions: ConnectToChannelOptions | undefined = options
            ? {
                  autoOpen: options.autoOpen,
                  shouldJoin: options.shouldJoin,
                  timeoutMs: options.timeoutMs,
                  balance: options.encodedBalance
                      ? Codec.decode(options.encodedBalance, Type.Balance)
                      : undefined
              }
            : undefined;
        DetachedPromises.collect(
            this.p2pManager.p2pSigner
                .connectToChannel(channelId as ChannelId, localOptions)
                .then((result) => {
                    if (!result) {
                        throw new Error(
                            `connectToChannel failed for ${channelId}`
                        );
                    }
                })
        );
        return true;
    }

    public async joinLobby(rendezvousTopic: string): Promise<boolean> {
        DetachedPromises.collect(
            this.p2pManager.p2pSigner.joinLobby(rendezvousTopic)
        );
        return true;
    }

    public async leaveLobby(rendezvousTopic: string): Promise<boolean> {
        return this.p2pManager.p2pSigner.leaveLobby(rendezvousTopic);
    }

    public async joinSelectedKey(channelId: string): Promise<boolean> {
        await this.p2pManager.stateManager.setChannelId(channelId as ChannelId);
        DetachedPromises.collect(this.p2pManager.joinDiscoveryKey(channelId));
        return true;
    }

    public async leaveSelectedKey(channelId: string): Promise<boolean> {
        await this.p2pManager.leaveDiscoveryKey(channelId);
        return true;
    }

    public getTransportToken(evmAddress: Address): number | null {
        return this.service.getTransportToken(evmAddress);
    }

    /** Close one transport without changing policy. Used by discovery probes. */
    public closePeerTransportByAddress(evmAddress: Address): boolean {
        const target = String(evmAddress).toLowerCase();
        const transport = this.p2pManager.openConnections.find((t) => {
            const profile =
                this.p2pManager.profileManager.getProfileByTransport(t);
            return (
                profile?.evmAddress !== undefined &&
                String(profile.evmAddress).toLowerCase() === target
            );
        });
        if (!transport) return false;
        this.p2pManager.disconnectConnection(transport);
        return true;
    }

    public blacklistAndDisconnectPeerByAddress(evmAddress: Address): boolean {
        this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(evmAddress);
        return this.p2pManager.isBlacklisted(evmAddress);
    }

    public unblacklistPeerByAddress(evmAddress: Address): boolean {
        return this.p2pManager.profileManager.unblacklistPeer(evmAddress);
    }
}

export default NetworkRpcMethods;
