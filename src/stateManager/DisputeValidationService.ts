import {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

import { LocalDiamond, StateChannelManagerProxy } from "@typechain-types";
import { ZeroHash } from "ethers";

import ADiamondStateMachine from "@/ADiamondStateMachine";
import Clock from "@/Clock";
import Storage from "@/storage";
import { Block, BlockCoordinates, StateSnapshot } from "@/models";
import { difference, isSubset } from "@/utils";
import { BlockValidationResult, TimeConfig } from "@/types";
import { Address, ChannelId, ForkId, Hash, Timestamp } from "@/types/types";

import DisputeFraudProofService from "./utils/DisputeFraudProofService";
import { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";
import { DisputeAuditingDataStruct } from "@typechain-types/contracts/V1/StateChannelManagerEvents";

export default class DisputeValidationService {
    private readonly disputeFraudProofService: DisputeFraudProofService;
    constructor(
        private readonly storage: Storage,
        private readonly diamondStateMachine: ADiamondStateMachine,
        private readonly stateChannelManagerContract: StateChannelManagerProxy,
        private readonly timeConfig: TimeConfig,
        private readonly channelId: ChannelId,
        private readonly getForkId: () => ForkId
    ) {
        this.disputeFraudProofService = new DisputeFraudProofService(
            this.storage
        );
    }

    async validateDisputeConfirmation(
        dispute: DisputeConfirmationStruct,
        onChainDisputeAuditingData?: DisputeAuditingDataStruct
    ): Promise<void> {
        if (!onChainDisputeAuditingData) {
        }
    }
}
