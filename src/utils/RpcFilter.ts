import P2PManager from "@/P2PManager";
import Rpc, { deserializeRpc } from "@/rpc/Rpc";
import { ATransport } from "@/transport";
import { MessageCache } from "./MessageCache";
import { MessageValidationService } from "./MessageValidationService";
import { createRateLimiter, RateLimiter } from "./RateLimiter";
import { Address } from "@/types/types";

export class RpcFileter {
    private inboundRateLimiters: Map<Address, RateLimiter> = new Map();
    private readonly validationService: MessageValidationService;
    private readonly messageCache: MessageCache;
    private readonly p2pManager: P2PManager;

    constructor(p2pManager: P2PManager) {
        this.p2pManager = p2pManager;
        const agreementTime = p2pManager.stateManager.timeConfig.agreementTime;
        this.validationService = new MessageValidationService(agreementTime);
        this.messageCache = new MessageCache(agreementTime);
    }

    /**
     * Get or create rate limiter for a transport connection
     */
    getInboundRateLimiter(address: Address): RateLimiter {
        let rateLimiter = this.inboundRateLimiters.get(address);
        if (!rateLimiter) {
            rateLimiter = createRateLimiter();
            this.inboundRateLimiters.set(address, rateLimiter);
        }
        return rateLimiter;
    }

    /**
     * Check RPC message for bandwidth management with signature-based deduplication
     * @param serializedRpc - The serialized RPC message
     * @returns Promise<boolean> - true if message should be allowed
     */
    async filterRpcMessage(
        serializedRpc: string,
        transport: ATransport
    ): Promise<Rpc | undefined> {
        try {
            const dataSizeBytes = Buffer.byteLength(serializedRpc, "utf8");
            const rpc = deserializeRpc(serializedRpc);
            const senderAddress = this.p2pManager.profileManager
                .getProfileByTransport(transport)
                ?.getEvmAddress();

            if (!senderAddress) {
                this.p2pManager.disconnectAndBlacklistPeer(transport);
                return undefined;
            }
            if (!rpc) {
                this.p2pManager.disconnectAndBlacklistPeer(transport);
                return undefined; // Invalid message format
            }

            const rpcHash = this.messageCache.isCached(serializedRpc);
            if (!rpcHash) {
                const isMalciousTimestamp =
                    this.validationService.isTimetampFradulent(rpc.timestamp);
                if (isMalciousTimestamp) {
                    this.p2pManager.disconnectAndBlacklistPeer(transport);
                    return undefined;
                }
                const isAcceptableTimestamp =
                    this.validationService.isAcceptableTimestamp(rpc.timestamp);
                if (!isAcceptableTimestamp) {
                    return undefined; // Message too old or too far in future
                }
                const issuerAddress =
                    await this.validationService.recoverAddressFromRpc(rpc);
                if (!issuerAddress) {
                    this.p2pManager.disconnectAndBlacklistPeer(transport);
                    return undefined; // Invalid signature
                }
                // TODO
                /*
                    Solution for general gossip needed here
                */
                const rateLimiter = this.getInboundRateLimiter(issuerAddress);
                const allowed = rateLimiter.checkAndConsume(dataSizeBytes);
                if (!allowed) {
                    // blacklist only the issuer not the sender
                    this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                        issuerAddress
                    );
                    return undefined;
                }
                // record only the sender, so the issuer may still send the same message
                this.messageCache.cacheMessage(serializedRpc, senderAddress);
                return rpc; // the RPC is allowed
            }
            // Message is cached
            if (this.messageCache.isAddressCached(rpcHash, senderAddress)) {
                // Message already processed from this sender -> blacklist
                this.p2pManager.disconnectAndBlacklistPeer(transport);
                return undefined;
            }
            // Cache the sender - there shouldn't be any race condition since this is sync code
            this.messageCache.cacheMessage(serializedRpc, senderAddress);

            return undefined; // message already processed
        } catch (error) {
            this.p2pManager.disconnectAndBlacklistPeer(transport);
            return undefined;
        }
    }

    /**
     * Dispose of the rate limiter manager
     */
    dispose(): void {
        this.inboundRateLimiters.clear();
        this.messageCache.dispose();
    }
}
