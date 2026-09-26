// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import { DEFAULT_MAX_CHANNEL_PARTICIPANTS } from "../../scripts/V1/deploy";
import { MathTestSession } from "@test/harness";
import { MathStateMachine__factory } from "@typechain-types";
import { expect } from "chai";
import { ethers } from "ethers";

export async function assertDeployedMaximum(maximum?: number) {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 0, { maxChannelParticipants: maximum });
    const expected = maximum ?? DEFAULT_MAX_CHANNEL_PARTICIPANTS;
    const managerAddress = await h.channelManager.getAddress();
    // Coupled to contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol:
    // slots 0..5 are p2pTime, agreementTime, chainFallbackTime, evidenceTime,
    // gasLimit and maxChannelParticipants (uint256 each); implementation is slot 6.
    // Update this index if that storage layout changes.
    const implementationSlot = await h.provider.getStorage(managerAddress, 6);
    const implementation = ethers.getAddress(
        ethers.dataSlice(implementationSlot, 12)
    );
    const onChainMath = MathStateMachine__factory.connect(
        implementation,
        h.provider
    );
    expect(Number(await h.channelManager.getMaxChannelParticipants())).to.equal(
        expected
    );
    expect(Number(await onChainMath.maxChannelParticipants())).to.equal(
        expected
    );
    for (const peer of h.peers) {
        expect(
            Number(await peer.contractInstance.maxChannelParticipants())
        ).to.equal(expected);
        expect(
            await h.execOnHost(
                peer,
                (sm) => sm.storage.queues.maxChannelParticipants
            )
        ).to.equal(expected);
    }
    return managerAddress;
}
