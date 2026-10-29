// @spec-test-coverage-ignore: shared fixture drives the real recovery caches; executable evidence belongs to its calling test declarations
import { createEvm } from "@/evm/EvmFactory";
import { createLogger } from "@/utils";
import { EVM } from "@ethereumjs/evm";
import { Address, bytesToHex, ecrecover, hexToBytes } from "@ethereumjs/util";
import { ethers, SigningKey } from "ethers";

const logger = createLogger({}, {}, { level: "error" });

const ECRECOVER = new Address(
    hexToBytes("0x0000000000000000000000000000000000000001")
);

/** Gas the ecrecover precompile charges (and needs) per call. */
export const ECRECOVER_PRECOMPILE_GAS = 3000n;

/** One precompile input: the 32-byte digest and a signature's (v, r, s). */
export type EcrecoverInput = {
    digest: string;
    v: number;
    r: string;
    s: string;
};

/** What a caller of the ecrecover precompile observes. */
export type EcrecoverRun = {
    returnValue: string;
    executionGasUsed: bigint;
    exceptionError: string | null;
};

/** `digest` (a random one by default) signed by a fresh wallet, as precompile input. */
export function signedDigest(
    digest: string = ethers.hexlify(ethers.randomBytes(32))
): {
    wallet: ethers.HDNodeWallet;
    input: EcrecoverInput;
} {
    const wallet = ethers.Wallet.createRandom();
    const signature = wallet.signingKey.sign(digest);
    return {
        wallet,
        input: { digest, v: signature.v, r: signature.r, s: signature.s }
    };
}

/** Call the ecrecover precompile of `evm` with `gasLimit`. */
export async function runEcrecover(
    evm: EVM,
    input: EcrecoverInput,
    gasLimit = 100_000n
): Promise<EcrecoverRun> {
    const result = await evm.runCall({
        to: ECRECOVER,
        gasLimit,
        data: ethers.getBytes(
            ethers.concat([
                input.digest,
                ethers.toBeHex(input.v, 32),
                input.r,
                input.s
            ])
        )
    });
    return {
        returnValue: bytesToHex(result.execResult.returnValue),
        executionGasUsed: result.execResult.executionGasUsed,
        exceptionError: result.execResult.exceptionError?.error ?? null
    };
}

/** The SDK's EVM (with the ecrecover memo) and one built without it. */
export async function cachedAndPlainEvm(): Promise<{
    cached: EVM;
    plain: EVM;
}> {
    return { cached: await createEvm({}, logger), plain: await EVM.create() };
}

/** Digest handed to one real (uncached) public-key recovery. */
export type RecoveredDigest = string;

/**
 * The SDK's EVM whose ecrecover memo wraps a record-only recorder: every
 * real recovery the memo asks for is recorded, then forwarded to
 * @ethereumjs/util's ecrecover. The recorder is installed on the EVM's own
 * Common (taken from a throwaway EVM, so it is the EVM's @ethereumjs/common
 * version) before createEvm installs the memo over it.
 */
export async function createRecordingEcrecoverEvm(): Promise<{
    evm: EVM;
    recoveries: RecoveredDigest[];
}> {
    const recoveries: RecoveredDigest[] = [];
    const { common } = await EVM.create();
    common.customCrypto.ecrecover = (msgHash, v, r, s, chainId) => {
        recoveries.push(bytesToHex(msgHash));
        return ecrecover(msgHash, v, r, s, chainId);
    };
    return { evm: await createEvm({ common }, logger), recoveries };
}

/** The memoized recovery an EVM's precompile calls, for direct use. */
export function installedEcrecover(evm: EVM): typeof ecrecover {
    const recover = evm.common.customCrypto.ecrecover;
    if (!recover) throw new Error("EVM has no ecrecover installed");
    return recover;
}

/**
 * A byte message (a random one by default) signed by a fresh wallet with an
 * EIP-191 signature.
 */
export async function signedMessage(
    message: Uint8Array = ethers.randomBytes(32)
): Promise<{
    wallet: ethers.HDNodeWallet;
    message: Uint8Array;
    signature: string;
}> {
    const wallet = ethers.Wallet.createRandom();
    const signature = await wallet.signMessage(message);
    return { wallet, message, signature };
}

/**
 * Record-only observation of ethers' public-key recovery, the secp256k1 work
 * behind every `verifyMessage`: each call is recorded with its digest and
 * forwarded to the real `SigningKey.recoverPublicKey`. `restore` reinstalls
 * the original; call it in `finally`.
 */
export function recordSignerRecoveries(): {
    recoveries: RecoveredDigest[];
    restore: () => void;
} {
    const recoveries: RecoveredDigest[] = [];
    const original = SigningKey.recoverPublicKey;
    SigningKey.recoverPublicKey = (digest, signature) => {
        recoveries.push(ethers.hexlify(digest));
        return original.call(SigningKey, digest, signature);
    };
    return {
        recoveries,
        restore: () => {
            SigningKey.recoverPublicKey = original;
        }
    };
}
