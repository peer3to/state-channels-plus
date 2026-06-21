import { Signer, Wallet } from "ethers";

import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import { addressesEqual } from "@/utils";
import SignerRpcMethods from "./SignerRpcMethods";

/**
 * Holds peer private keys so the host can re-sign blocks/disputes authored by
 * *any* peer — a peer's own host otherwise holds only its own key. Test-only:
 * keys are mnemonic-derived and pushed in by the harness. Accessors/state live
 * here (not on the RpcMethods class), which is routable by name at runtime.
 */
export class SignerService extends ARpcService<SignerRpcMethods> {
    private readonly peerSigners = new Map<string, Wallet>();

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessSignerService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }

    /** Register peer private keys (keyed by lowercased address). */
    registerPeerSigners(secrets: string[]): void {
        for (const secret of secrets) {
            const wallet = new Wallet(secret);
            this.peerSigners.set(wallet.address.toLowerCase(), wallet);
        }
    }

    /** Signer for `participant`: a registered peer key, or this peer's own. */
    signerForAddress(participant: string): Signer {
        const wallet = this.peerSigners.get(participant.toLowerCase());
        if (wallet) return wallet;
        if (addressesEqual(participant, this.sm.signerAddress))
            return this.sm.signer;
        throw new Error(
            `No registered signer for ${participant} — call registerPeerSigners first`
        );
    }

    public createRPCMethods(transport: ATransport): SignerRpcMethods {
        return new SignerRpcMethods(transport, this);
    }
}

export default SignerService;
