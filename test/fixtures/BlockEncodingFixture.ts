// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import type { Bytes } from "@/types/types";
import { ethers } from "ethers";

/** A block author's signature over exactly these block bytes. */
export function signEncodedBlock(
    wallet: ethers.BaseWallet,
    encodedBlock: Bytes
): string {
    return wallet.signMessageSync(
        ethers.getBytes(ethers.keccak256(encodedBlock))
    );
}
