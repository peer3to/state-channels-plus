import { HarnessBlock } from "./HarnessBlock";
import { Codec, Type, hash } from "@/utils";
import { SignatureUtils } from "@/utils/SignatureUtils";

class DisputeTampering {
    /**
     * Tampers with the auditing data hash to make it incorrect
     */
    static tamperAuditingDataHash(dispute: {
        input: { disputeAuditingDataHash: string };
    }): void {
        // Tamper: set incorrect auditing data hash (dummy value)
        dispute.input.disputeAuditingDataHash = hash("0x42");
    }

    /**
     * Tampers with the timeout participant address
     */
    static createTamperTimeoutParticipant(
        wrongParticipantAddress: string,
        blockHeight: number
    ) {
        return (dispute: {
            input: { timeout: { participant: string; blockHeight: number } };
        }): void => {
            // Tamper: set timeout participant to someone who is NOT next to write
            dispute.input.timeout.participant = wrongParticipantAddress;
            dispute.input.timeout.blockHeight = blockHeight;
        };
    }

    /**
     * Tampers BOTH the auditing data hash AND the latest state snapshot hash
     * This causes both commitment check and state proof verification to fail
     */
    static tamperDoubleFault(dispute: {
        input: {
            disputeAuditingDataHash: string;
            latestStateSnapshotHash: string;
        };
    }): void {
        // Tamper BOTH: auditing data hash (commitment check fails)
        dispute.input.disputeAuditingDataHash = hash("0x42");
        // AND: latest state snapshot hash (state proof verification fails)
        dispute.input.latestStateSnapshotHash = hash("0x43");
    }

    /**
     * Tampers the latest state snapshot hash ONLY (commitment stays valid)
     */
    static tamperInvalidStateProof(dispute: {
        input: { latestStateSnapshotHash: string };
    }): void {
        // Only tamper the state proof (commitment stays valid)
        dispute.input.latestStateSnapshotHash = hash("0x42");
    }

    /**
     * Tampers with the first milestone's first block to reference an unknown snapshot
     * This makes auditing data reconstruction partial (missing snapshot) and state proof invalid
     */
    static tamperPartialAuditing(dispute: {
        input: { stateProof: any };
    }): void {
        const tamperedStateProof = dispute.input.stateProof;
        if (
            tamperedStateProof.milestones.length === 0 ||
            tamperedStateProof.milestones[0].blockConfirmations.length === 0
        ) {
            throw new Error("No milestones to tamper");
        }
        const firstBc = tamperedStateProof.milestones[0].blockConfirmations[0];
        const block = Codec.decode(
            firstBc.signedBlock.encodedBlock,
            Type.Block
        );

        // Tamper: Set to unknown snapshot hash (not stored - makes auditing data partial)
        block.stateSnapshotHash = hash("0xDEADBEEF");

        firstBc.signedBlock.encodedBlock = Codec.encode(block, Type.Block);
    }
}

/**
 * Malicious behavior patterns and attack scenarios
 */
export class Byzantine {
    /**
     * Peer submits a double-signed block (two blocks at same height)
     */
    static doubleSignFrom(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            await harness.byzantineActions.submitDoubleSignBlock(peerIndex, {
                forkId
            });

            return harness;
        });
    }

    /**
     * Peer submits an invalid state transition
     */
    static invalidTransitionFrom(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            await harness.byzantineActions.submitInvalidStateTransitionBlock(
                peerIndex,
                { forkId }
            );

            return harness;
        });
    }

    /**
     * Next peer to write submits an invalid state transition (dynamic peer selection)
     */
    static invalidTransitionFromNext() {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            // Dynamically select the next peer who should write
            const maliciousPeer = await harness.stateQuery.getNextPeerToWrite();

            // Store malicious peer index on harness for use by Event/Assert blocks
            harness.context.lastMaliciousPeerIndex = maliciousPeer.index;

            // Submit invalid transition (action only, no waiting)
            await harness.byzantineActions.submitInvalidStateTransitionBlock(
                maliciousPeer.index,
                { forkId }
            );

            return harness;
        });
    }

    /**
     * Peer submits a forged inbound message block
     */
    static forgedInboundMessageFrom(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            await harness.byzantineActions.submitForgedInboundMessageBlock(
                peerIndex,
                { forkId }
            );

            return harness;
        });
    }

    /**
     * Next peer to write submits a forged inbound message block (dynamic peer selection)
     */
    static forgedInboundMessageFromNext() {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            // Dynamically select the next peer who should write
            const maliciousPeer = await harness.stateQuery.getNextPeerToWrite();

            // Store malicious peer index on harness for use by Event/Assert blocks
            harness.context.lastMaliciousPeerIndex = maliciousPeer.index;

            // Submit forged inbound message block (action only, no waiting)
            await harness.byzantineActions.submitForgedInboundMessageBlock(
                maliciousPeer.index,
                { forkId }
            );

            return harness;
        });
    }

    /**
     * Peer posts a tampered dispute with incorrect auditing data hash
     */
    static tamperedDisputeAuditingData(peerIndex: number) {
        return Byzantine.postTamperedDisputeWith(
            peerIndex,
            DisputeTampering.tamperAuditingDataHash
        );
    }

    /**
     * Peer posts a tampered timeout dispute with wrong participant
     */
    static tamperedTimeoutDispute(options: {
        submitter: number;
        wrongParticipant: number;
        blockHeight?: number;
    }) {
        const { submitter, wrongParticipant, blockHeight = 2 } = options;

        return new HarnessBlock(async (harness) => {
            const notNextPeer = harness.peers[wrongParticipant];
            if (!notNextPeer) {
                throw new Error(`Peer ${wrongParticipant} not found`);
            }

            const tamperFn = DisputeTampering.createTamperTimeoutParticipant(
                notNextPeer.address,
                blockHeight
            );

            // Compose with the generic block
            return await Byzantine.postTamperedDisputeWith(
                submitter,
                tamperFn
            ).run(harness);
        });
    }

    /**
     * Peer posts a tampered dispute where auditing data is partial and state proof invalid
     */
    static tamperedDisputePartialAuditing(peerIndex: number) {
        return Byzantine.postTamperedDisputeWith(
            peerIndex,
            DisputeTampering.tamperPartialAuditing
        );
    }

    /**
     * Peer posts a tampered dispute with BOTH invalid commitment AND invalid state proof
     */
    static tamperedDisputeDoubleFault(peerIndex: number) {
        return Byzantine.postTamperedDisputeWith(
            peerIndex,
            DisputeTampering.tamperDoubleFault
        );
    }

    /**
     * Peer posts a tampered dispute with invalid state proof ONLY (commitment is valid)
     */
    static tamperedDisputeInvalidStateProof(peerIndex: number) {
        return Byzantine.postTamperedDisputeWith(
            peerIndex,
            DisputeTampering.tamperInvalidStateProof
        );
    }

    /**
     * Peer posts invalid calldata on-chain (junk calldata with invalid signature)
     */
    static postJunkCalldata(
        peerIndex: number,
        options?: { heightOffset?: number }
    ) {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            const currentBlock =
                harness.peers[0].stateManager.storage.blocks.getLatestBlock(
                    forkId
                );
            if (!currentBlock) {
                throw new Error("No current block found");
            }

            const heightOffset = options?.heightOffset ?? 1;
            await harness.byzantineActions.postJunkCalldataOnChain(peerIndex, {
                height: currentBlock.height + heightOffset
            });

            return harness;
        });
    }

    // ========================================
    // TAMPERED DISPUTES - Dispute Validation Testing
    // ========================================

    /**
     * Generic block: Post a tampered dispute with a custom tamper function
     */
    static postTamperedDisputeWith(
        peerIndex: number,
        tamperFn: (dispute: any) => void
    ) {
        return new HarnessBlock(async (harness) => {
            const forkId = harness.activeForkId;
            if (!forkId) {
                throw new Error(
                    "No active fork ID - channel must be opened first"
                );
            }

            const { dispute } =
                await harness.disputeOrchestrator.postTamperedDispute(
                    peerIndex,
                    tamperFn,
                    forkId
                );

            // Store dispute for later assertions
            harness.context.lastTamperedDispute = dispute;

            return harness;
        });
    }

    /**
     * Setup tampered dispute construction interception for a peer
     */
    static interceptDisputeConstruction(options: {
        peerIndex: number;
        tamperFn: (dispute: any, confirmation: any) => void | Promise<void>;
    }) {
        const { peerIndex, tamperFn } = options;

        return new HarnessBlock(async (harness) => {
            const { dispute: tamperedDisputePromise, restore } =
                harness.disputeOrchestrator.withConstructDisputeTampering(
                    peerIndex,
                    async (res) => {
                        // Apply the tamper function
                        await tamperFn(res.dispute, res.disputeConfirmation);

                        // Re-sign the tampered dispute
                        const peer = harness.peers[peerIndex];
                        const tamperedSig = await SignatureUtils.signDispute(
                            res.dispute,
                            peer.signer
                        );
                        res.disputeConfirmation.signedDispute = {
                            encodedDispute: tamperedSig.encoded,
                            signature: tamperedSig.signature as any
                        };

                        return res;
                    }
                );

            // Store the promise and restore function
            harness.context.tamperedDisputePromise = tamperedDisputePromise;
            harness.context.restoreDisputeConstruction = restore;

            return harness;
        });
    }

    // ========================================
    // NETWORK MANIPULATION - Connectivity & Isolation
    // ========================================

    /**
     * Disconnect a peer from the P2P network
     */
    static disconnect(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            await harness.networkController.disconnectPeer(peerIndex);
            return harness;
        });
    }

    /**
     * Simulate a peer timeout (disconnect + wait for timeout events)
     */
    static timeout(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            await harness.networkController.simulatePeerTimeout(peerIndex);
            return harness;
        });
    }

    /**
     * Stub a peer's calldata handler to prevent syncing from on-chain calldata
     */
    static stubCalldataHandler(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            const eventHandler = peer.stateManager.eventHandler;
            const originalHandler =
                eventHandler.onBlockCalldataPosted.bind(eventHandler);

            // Store original handler for potential restoration
            harness.context[`peer${peerIndex}OriginalCalldataHandler`] =
                originalHandler;

            // Stub with no-op
            eventHandler.onBlockCalldataPosted = async () => {
                // No-op: peer won't process calldata
            };

            return harness;
        });
    }

    /**
     * Restore a peer's original calldata handler
     */
    static restoreCalldataHandler(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            const originalHandler =
                harness.context[`peer${peerIndex}OriginalCalldataHandler`];
            if (!originalHandler) {
                throw new Error(
                    `No original calldata handler found for peer ${peerIndex}`
                );
            }

            peer.stateManager.eventHandler.onBlockCalldataPosted =
                originalHandler;

            return harness;
        });
    }

    /**
     * Stub a peer's broadcast function to prevent broadcasting blocks
     */
    static stubBroadcast(peerIndex: number) {
        return new HarnessBlock(async (harness) => {
            const peer = harness.peers[peerIndex];
            if (!peer) {
                throw new Error(`Peer ${peerIndex} not found`);
            }

            const remoteRpc = peer.stateManager.p2pManager.remoteRpc;

            // Store original function for potential restoration
            harness.context[`peer${peerIndex}OriginalBroadcast`] =
                remoteRpc.stateTransitionService.onBlockConfirmation;

            // Stub with no-op broadcast
            remoteRpc.stateTransitionService.onBlockConfirmation = (
                _blockConfirmation
            ) => {
                peer.logger.info("Suppressed broadcast from peer " + peerIndex);
                return {
                    broadcast: () => {},
                    sendOne: () => {},
                    sendMultiple: () => {}
                } as any;
            };

            return harness;
        });
    }
}
