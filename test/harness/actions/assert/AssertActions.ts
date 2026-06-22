import { expect } from "chai";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { Logger, addressesEqual } from "@/utils";
import {
    AssertCalldataActions,
    AssertDisputeActions,
    AssertRPCActions,
    AssertSnapshotActions,
    AssertSyncActions
} from ".";
import { AssertStorageActions } from "./AssertStorageActions";

export class AssertActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    public readonly calldata: AssertCalldataActions<TCustomRpc>;
    public readonly dispute: AssertDisputeActions<TCustomRpc>;
    public readonly rpc: AssertRPCActions<TCustomRpc>;
    public readonly snapshot: AssertSnapshotActions<TCustomRpc>;
    public readonly sync: AssertSyncActions<TCustomRpc>;
    public readonly storage: AssertStorageActions<TCustomRpc>;

    constructor(
        private harness: PeerTestHarness<TCustomRpc>,
        private logger: Logger
    ) {
        this.calldata = new AssertCalldataActions(this.harness);
        this.dispute = new AssertDisputeActions(this.harness);
        this.rpc = new AssertRPCActions(this.harness);
        this.snapshot = new AssertSnapshotActions(this.harness);
        this.sync = new AssertSyncActions(this.harness);
        this.storage = new AssertStorageActions(this.harness);
    }

    async slashedOnChain(
        address: string,
        msg = `${address} must be on-chain slashed`
    ): Promise<void> {
        const slashed =
            await this.harness.channelManager.getOnChainSlashedParticipants(
                this.harness.channelId
            );
        expect(
            slashed.some((a) => addressesEqual(a, address)),
            msg
        ).to.equal(true);
    }

    async slashedOnChainExactly(addresses: string[]): Promise<void> {
        const slashed =
            await this.harness.channelManager.getOnChainSlashedParticipants(
                this.harness.channelId
            );
        for (const address of addresses) {
            expect(
                slashed.some((a) => addressesEqual(a, address)),
                `${address} must be on-chain slashed`
            ).to.equal(true);
        }
        const unexpected = slashed.filter(
            (a) => !addresses.some((addr) => addressesEqual(a, addr))
        );
        expect(
            unexpected,
            `unexpected on-chain slashes: ${unexpected.join(", ")}`
        ).to.have.length(0);
    }
}
