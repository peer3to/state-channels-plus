// @spec-test-coverage-ignore: test-root negotiation service for mapped opening-data component cases
import OpenChannelNegotiationService from "@/rpc/network/services/openChannelNegotiation/OpenChannelNegotiationService";
import type { OpenChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers, type BytesLike } from "ethers";

export type OpeningTerms = Pick<
    OpenChannelStruct,
    "channelId" | "participants" | "balances"
>;

/** A buildOpeningData call the probe holds until it settles it. */
export type HeldDerivation = {
    terms: OpeningTerms;
    resolve: (data: BytesLike) => void;
    reject: (error: Error) => void;
};

/**
 * Opening data derived as a pure function of the agreed terms, the way a
 * custom root derives its genesis.
 */
export function deriveOpeningData(terms: OpeningTerms): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address[]", "tuple(uint256 amount, bytes data)[]"],
        [
            terms.channelId,
            terms.participants,
            terms.balances.map((balance) => [balance.amount, balance.data])
        ]
    );
}

/**
 * A custom root's negotiation service: it supplies application opening data
 * from the agreed terms. The probe can fail the derivation or hold a call
 * until it settles it, to reach the local-failure and stale-completion paths.
 */
export class OpeningDataNegotiationService extends OpenChannelNegotiationService {
    /** Terms of every buildOpeningData call, in call order. */
    public readonly derivationCalls: OpeningTerms[] = [];
    /** When set, every derivation fails with this message. */
    public derivationFailure?: string;
    // Number of upcoming derivations to hold.
    private armedHolds = 0;
    private readonly heldDerivations: HeldDerivation[] = [];

    // Replaces OpenChannelNegotiationService.buildOpeningData: derives the
    // data from the terms, with probe-controlled failure and hold.
    protected override async buildOpeningData(
        terms: OpeningTerms
    ): Promise<BytesLike> {
        this.derivationCalls.push(terms);
        if (this.armedHolds > 0) {
            this.armedHolds -= 1;
            return new Promise<BytesLike>((resolve, reject) => {
                this.heldDerivations.push({ terms, resolve, reject });
            });
        }
        if (this.derivationFailure) {
            throw new Error(this.derivationFailure);
        }
        return deriveOpeningData(terms);
    }

    /** Holds the next derivation until the probe settles it. */
    public holdNextDerivation(): void {
        this.armedHolds += 1;
    }

    /** Removes and returns the oldest held derivation. */
    public takeHeldDerivation(): HeldDerivation | undefined {
        return this.heldDerivations.shift();
    }
}
