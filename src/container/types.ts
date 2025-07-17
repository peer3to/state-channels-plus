export const ServiceNames = {
    STORAGE: "storage",
    AGREEMENT_MANAGER: "agreementManager",
    STATE_MANAGER: "stateManager",
    DISPUTE_HANDLER: "disputeHandler",
    P2P_MANAGER: "p2pManager",
    VALIDATION_SERVICE: "validationService",
    EXECUTION_DECISION_PROCESSOR: "executionDecisionProcessor",
    PROOF_MANAGER: "proofManager",
    STATE_CHANNEL_EVENT_LISTENER: "stateChannelEventListener",
    P2P_SIGNER: "p2pSigner"
} as const;

export type ServiceName = (typeof ServiceNames)[keyof typeof ServiceNames];

/**
 * Service registry type for type-safe service resolution
 */
export interface ServiceRegistry {
    [ServiceNames.STORAGE]: import("@/storage").default;
    [ServiceNames.AGREEMENT_MANAGER]: import("@/agreementManager").default;
    [ServiceNames.STATE_MANAGER]: import("@/stateManager").default;
    [ServiceNames.DISPUTE_HANDLER]: import("@/DisputeHandler").default;
    [ServiceNames.P2P_MANAGER]: import("@/P2PManager").default;
    [ServiceNames.VALIDATION_SERVICE]: import("@/stateManager/ValidationService").default;
    [ServiceNames.EXECUTION_DECISION_PROCESSOR]: import("@/stateManager/executionDecisionProcessor").ExecutionDecisionProcessor;
    [ServiceNames.PROOF_MANAGER]: import("@/ProofManager").default;
    [ServiceNames.STATE_CHANNEL_EVENT_LISTENER]: import("@/StateChannelEventListener").default;
    [ServiceNames.P2P_SIGNER]: import("@/evm/P2pSigner").default;
}
