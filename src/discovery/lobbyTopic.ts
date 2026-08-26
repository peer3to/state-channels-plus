import { ethers } from "ethers";
import { Buffer } from "buffer";
import { getChecksumAddress } from "@/utils";
import { config } from "@/utils/config";

// Domain-separates lobby DHT topics from any other topic namespace derived
// from a state-channel manager address (e.g. the channel-topic derivation).
export const LOBBY_TOPIC_PREFIX = "peer3:lobby";

/**
 * Derives the 32-byte lobby DHT topic from real entropy:
 * keccak256(abi.encode(["string","uint256","address","string","uint16"],
 *   [LOBBY_TOPIC_PREFIX, chainId, stateChannelManagerAddress, appNamespace, version]))
 *
 * `stateChannelManagerAddress` is normalised via getChecksumAddress before
 * encoding, so casing never changes the topic. `appNamespace` has no hidden
 * fallback here — when config.LOBBY_APP_NAMESPACE is empty, the caller must
 * supply the state-machine contract address itself.
 */
export function deriveLobbyTopic(params: {
    chainId: bigint | number;
    stateChannelManagerAddress: string;
    appNamespace: string;
    version?: number;
}): Buffer {
    const version = params.version ?? config.LOBBY_TOPIC_VERSION;
    const normalizedManagerAddress = getChecksumAddress(
        params.stateChannelManagerAddress
    );

    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "uint256", "address", "string", "uint16"],
        [
            LOBBY_TOPIC_PREFIX,
            params.chainId,
            normalizedManagerAddress,
            params.appNamespace,
            version
        ]
    );
    const hash = ethers.keccak256(encoded);
    return Buffer.from(ethers.getBytes(hash));
}
