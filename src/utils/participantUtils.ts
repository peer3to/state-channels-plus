import { BytesLike } from "ethers";
import { AStateChannelManagerProxy } from "@typechain-types";
import { difference } from "./set";

export async function getActiveParticipants(
    contract: AStateChannelManagerProxy,
    channelId: BytesLike
): Promise<Set<string>> {
    const snapshotParticipants = new Set(
        await contract.getSnapshotParticipants(channelId)
    );
    const slashedParticipants = new Set(
        await contract.getOnChainSlashedParticipants(channelId)
    );

    return difference(snapshotParticipants, slashedParticipants);
}
