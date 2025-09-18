// Auto-generated. Do not edit.

export const BlockEthersType = `tuple(tuple(tuple(bytes32,address,bytes32,uint256,uint256),tuple(bytes,bytes)),bytes32,bytes32)`;

export const TransactionEthersType = `tuple(tuple(bytes32,address,bytes32,uint256,uint256),tuple(bytes,bytes))`;

export const TransactionHeaderEthersType = `tuple(bytes32,address,bytes32,uint256,uint256)`;

export const TransactionBodyEthersType = `tuple(bytes,bytes)`;

export const SignedBlockEthersType = `tuple(bytes,bytes)`;

export const BlockConfirmationEthersType = `tuple(tuple(bytes,bytes),bytes[])`;

export const BalanceEthersType = `tuple(uint256,bytes)`;

export const JoinChannelEthersType = `tuple(bytes32,address,uint256,tuple(uint256,bytes))`;

export const JoinChannelBlockEthersType = `tuple(bytes32,tuple(bytes32,address,uint256,tuple(uint256,bytes))[])`;

export const SignedJoinChannelEthersType = `tuple(bytes,bytes)`;

export const JoinChannelConfirmationEthersType = `tuple(tuple(bytes,bytes),bytes[])`;

export const ExitChannelEthersType = `tuple(address,tuple(uint256,bytes))`;

export const ExitChannelBlockEthersType = `tuple(tuple(address,tuple(uint256,bytes))[],bytes32)`;

export const StateSnapshotEthersType = `tuple(tuple(bytes32,address[],bytes32,bytes32,tuple(uint256,bytes),tuple(uint256,bytes)),bytes32,uint256,uint256)`;

export const SnapshotDataEthersType = `tuple(bytes32,address[],bytes32,bytes32,tuple(uint256,bytes),tuple(uint256,bytes))`;

export const OnChainJoinChannelEthersType = `tuple(bytes32,tuple(uint256,bytes),uint256)`;

export const DisputeNotLatestStateProofEthersType = `tuple(bytes,bytes)`;

export const DisputeOutOfGasProofEthersType = `tuple(tuple(bytes32,bytes32,bytes32,tuple(tuple(tuple(tuple(bytes,bytes),bytes[])[])[],tuple(bytes,bytes)[]),tuple(uint8,address,bytes)[],address[],bytes32,bytes32,address,tuple(address,uint256,uint256,bool,address,bool),bool))`;

export const DisputeEthersType = `tuple(bytes32,bytes32,bytes32,tuple(tuple(tuple(tuple(bytes,bytes),bytes[])[])[],tuple(bytes,bytes)[]),tuple(uint8,address,bytes)[],address[],bytes32,bytes32,address,tuple(address,uint256,uint256,bool,address,bool),bool)`;

export const StateProofEthersType = `tuple(tuple(tuple(tuple(bytes,bytes),bytes[])[])[],tuple(bytes,bytes)[])`;

export const MilestoneProofEthersType = `tuple(tuple(tuple(bytes,bytes),bytes[])[])`;

export const FraudProofEthersType = `tuple(uint8,address,bytes)`;

export const TimeoutEthersType = `tuple(address,uint256,uint256,bool,address,bool)`;

export const DisputeInvalidOutputStateProofEthersType = `tuple(tuple(bytes32,bytes32,bytes32,tuple(tuple(tuple(tuple(bytes,bytes),bytes[])[])[],tuple(bytes,bytes)[]),tuple(uint8,address,bytes)[],address[],bytes32,bytes32,address,tuple(address,uint256,uint256,bool,address,bool),bool))`;

export const DisputeInvalidStateProofEthersType = `tuple(tuple(bytes32,bytes32,bytes32,tuple(tuple(tuple(tuple(bytes,bytes),bytes[])[])[],tuple(bytes,bytes)[]),tuple(uint8,address,bytes)[],address[],bytes32,bytes32,address,tuple(address,uint256,uint256,bool,address,bool),bool))`;

export const DisputeInvalidPreviousRecursiveProofEthersType = `tuple(tuple(bytes32,bytes32,bytes32,tuple(tuple(tuple(tuple(bytes,bytes),bytes[])[])[],tuple(bytes,bytes)[]),tuple(uint8,address,bytes)[],address[],bytes32,bytes32,address,tuple(address,uint256,uint256,bool,address,bool),bool),tuple(bytes32,bytes32,bytes32,tuple(tuple(tuple(tuple(bytes,bytes),bytes[])[])[],tuple(bytes,bytes)[]),tuple(uint8,address,bytes)[],address[],bytes32,bytes32,address,tuple(address,uint256,uint256,bool,address,bool),bool),uint256,uint256,bytes,bytes)`;

export const DisputeInvalidExitChannelBlocksProofEthersType = `tuple(tuple(bytes32,bytes32,bytes32,tuple(tuple(tuple(tuple(bytes,bytes),bytes[])[])[],tuple(bytes,bytes)[]),tuple(uint8,address,bytes)[],address[],bytes32,bytes32,address,tuple(address,uint256,uint256,bool,address,bool),bool))`;

export const TimeoutThresholdProofEthersType = `tuple(tuple(tuple(bytes,bytes),bytes[]),tuple(tuple(bytes32,address[],bytes32,bytes32,tuple(uint256,bytes),tuple(uint256,bytes)),bytes32,uint256,uint256))`;

export const TimeoutCalldataPostedProofEthersType = `tuple(tuple(tuple(tuple(bytes32,address,bytes32,uint256,uint256),tuple(bytes,bytes)),bytes32,bytes32))`;

export const TimeoutParticipantNotNextProofEthersType = `tuple(tuple(bytes32,bytes32,bytes32,tuple(tuple(tuple(tuple(bytes,bytes),bytes[])[])[],tuple(bytes,bytes)[]),tuple(uint8,address,bytes)[],address[],bytes32,bytes32,address,tuple(address,uint256,uint256,bool,address,bool),bool),tuple(bytes32,bytes32,bytes32,tuple(tuple(tuple(tuple(bytes,bytes),bytes[])[])[],tuple(bytes,bytes)[]),tuple(uint8,address,bytes)[],address[],bytes32,bytes32,address,tuple(address,uint256,uint256,bool,address,bool),bool),uint256,uint256)`;

export const SignedDisputeEthersType = `tuple(bytes,bytes)`;

export const DisputeConfirmationEthersType = `tuple(tuple(bytes,bytes),bytes[])`;

export const DisputeWindowReducedResultEthersType = `tuple(bytes32,uint256,uint256,address)`;

export const ReduceOutputEthersType = `tuple(tuple(tuple(tuple(bytes32,address,bytes32,uint256,uint256),tuple(bytes,bytes)),bytes32,bytes32),address[],bytes32,tuple(address,uint256,uint256,bool,address,bool),address[],uint256)`;

export const OnChainSlashEthersType = `tuple(address,uint256)`;

export const DisputeAuditingDataEthersType = `tuple(tuple(tuple(bytes32,address[],bytes32,bytes32,tuple(uint256,bytes),tuple(uint256,bytes)),bytes32,uint256,uint256),tuple(tuple(bytes32,address[],bytes32,bytes32,tuple(uint256,bytes),tuple(uint256,bytes)),bytes32,uint256,uint256),tuple(tuple(bytes32,address[],bytes32,bytes32,tuple(uint256,bytes),tuple(uint256,bytes)),bytes32,uint256,uint256)[],bytes,tuple(tuple(address,tuple(uint256,bytes))[],bytes32)[])`;

export const FraudProofVerificationContextEthersType = `tuple(bytes32)`;

export const DisputeOutputStateEthersType = `tuple(bytes,tuple(tuple(address,tuple(uint256,bytes))[],bytes32),tuple(uint256,bytes),tuple(uint256,bytes))`;

export const BlockEmptyProofEthersType = `tuple(tuple(bytes,bytes),tuple(bytes,bytes))`;

export const BlockInvalidStateTransitionProofEthersType = `tuple(tuple(bytes,bytes),tuple(bytes,bytes),tuple(tuple(bytes32,address[],bytes32,bytes32,tuple(uint256,bytes),tuple(uint256,bytes)),bytes32,uint256,uint256),bytes)`;

export const BlockDoubleSignProofEthersType = `tuple(tuple(bytes,bytes),tuple(bytes,bytes))`;

export const InvalidTimestampProofEthersType = `tuple(tuple(bytes,bytes),tuple(bytes,bytes),tuple(tuple(bytes32,address[],bytes32,bytes32,tuple(uint256,bytes),tuple(uint256,bytes)),bytes32,uint256,uint256))`;

export const WrongGenesisProofEthersType = `tuple(tuple(bytes,bytes),tuple(tuple(bytes32,address[],bytes32,bytes32,tuple(uint256,bytes),tuple(uint256,bytes)),bytes32,uint256,uint256))`;

export const DisputeFraudProofEthersType = `tuple(uint8,address,tuple(bytes32,bytes32,bytes32,tuple(tuple(tuple(tuple(bytes,bytes),bytes[])[])[],tuple(bytes,bytes)[]),tuple(uint8,address,bytes)[],address[],bytes32,bytes32,address,tuple(address,uint256,uint256,bool,address,bool),bool),bytes)`;
