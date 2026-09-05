import { expect } from "chai";
import { ethers } from "ethers";

import { Codec, Type } from "@/utils/Codec";
import { DisputeFraudProofType, FraudProofType } from "@/types/sol-enums";
import {
    codecValues,
    codecTestAddress,
    expectCodecRoundTrip
} from "../fixtures/CodecFixtures";

describe("Codec", function () {
    it("the existing-window flag survives nested confirmation encoding and binds the signature", async function () {
        const signer = ethers.Wallet.createRandom();
        const dispute = codecValues.dispute();
        dispute.input.requireExistingDisputeWindow = true;
        const encoded = Codec.encode(dispute, Type.Dispute);
        const signature = await signer.signMessage(
            ethers.getBytes(ethers.keccak256(encoded))
        );
        const confirmation = {
            signedDispute: { encodedDispute: encoded, signature },
            signatures: []
        };
        const nested = Codec.decode(
            Codec.encode(confirmation, Type.DisputeConfirmation),
            Type.DisputeConfirmation
        );
        const restored = Codec.decode(
            nested.signedDispute.encodedDispute,
            Type.Dispute
        );
        expect(restored.input.requireExistingDisputeWindow).to.equal(true);
        expect(
            ethers.verifyMessage(
                ethers.getBytes(
                    ethers.keccak256(nested.signedDispute.encodedDispute)
                ),
                ethers.hexlify(nested.signedDispute.signature)
            )
        ).to.equal(signer.address);
        restored.input.requireExistingDisputeWindow = false;
        const changed = Codec.encode(restored, Type.Dispute);
        expect(
            ethers.verifyMessage(
                ethers.getBytes(ethers.keccak256(changed)),
                ethers.hexlify(nested.signedDispute.signature)
            )
        ).to.not.equal(signer.address);
        expect(
            Codec.decode(changed, Type.Dispute).input
                .requireExistingDisputeWindow
        ).to.equal(false);
    });

    it("round-trips Block", function () {
        const value = codecValues.block();
        const encoded = Codec.encode(value, Type.Block);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, Type.Block));
    });

    it("round-trips BlockCommitment", function () {
        const value = codecValues.blockCommitment();
        const encoded = Codec.encode(value, Type.BlockCommitment);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.BlockCommitment)
        );
    });

    it("round-trips JoinChannel", function () {
        const value = codecValues.joinChannel();
        const encoded = Codec.encode(value, Type.JoinChannel);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.JoinChannel)
        );
    });

    it("round-trips SignedJoinChannel", function () {
        const value = codecValues.signedJoinChannel();
        const encoded = Codec.encode(value, Type.SignedJoinChannel);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.SignedJoinChannel)
        );
    });

    it("round-trips JoinChannelConfirmation", function () {
        const value = codecValues.joinChannelConfirmation();
        const encoded = Codec.encode(value, Type.JoinChannelConfirmation);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.JoinChannelConfirmation)
        );
    });

    it("round-trips OpenChannel", function () {
        const value = codecValues.openChannel();
        const encoded = Codec.encode(value, Type.OpenChannel);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.OpenChannel)
        );
    });

    it("round-trips BlockConfirmation", function () {
        const value = codecValues.blockConfirmation();
        const encoded = Codec.encode(value, Type.BlockConfirmation);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.BlockConfirmation)
        );
    });

    it("round-trips Transaction", function () {
        const value = codecValues.transaction();
        const encoded = Codec.encode(value, Type.Transaction);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.Transaction)
        );
    });

    it("round-trips Dispute", function () {
        const value = codecValues.dispute();
        const encoded = Codec.encode(value, Type.Dispute);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.Dispute)
        );
    });

    it("round-trips DisputeConfirmation", function () {
        const value = codecValues.disputeConfirmation();
        const encoded = Codec.encode(value, Type.DisputeConfirmation);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.DisputeConfirmation)
        );
    });

    it("round-trips StateSnapshot", function () {
        const value = codecValues.stateSnapshot();
        const encoded = Codec.encode(value, Type.StateSnapshot);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.StateSnapshot)
        );
    });

    it("round-trips SnapshotData", function () {
        const value = codecValues.snapshotData();
        const encoded = Codec.encode(value, Type.SnapshotData);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.SnapshotData)
        );
    });

    it("round-trips JoinChannelBlock", function () {
        const value = codecValues.joinChannelBlock();
        const encoded = Codec.encode(value, Type.JoinChannelBlock);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.JoinChannelBlock)
        );
    });

    it("round-trips ExitChannelBlock", function () {
        const value = codecValues.exitChannelBlock();
        const encoded = Codec.encode(value, Type.ExitChannelBlock);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.ExitChannelBlock)
        );
    });

    it("round-trips ExitChannel", function () {
        const value = codecValues.exitChannel();
        const encoded = Codec.encode(value, Type.ExitChannel);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.ExitChannel)
        );
    });

    it("round-trips DisputeAuditingData", function () {
        const value = codecValues.disputeAuditingData();
        const encoded = Codec.encode(value, Type.DisputeAuditingData);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.DisputeAuditingData)
        );
    });

    it("round-trips MessageBlock", function () {
        const value = codecValues.messageBlock();
        const encoded = Codec.encode(value, Type.MessageBlock);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.MessageBlock)
        );
    });

    it("round-trips Balance", function () {
        const value = codecValues.balance();
        const encoded = Codec.encode(value, Type.Balance);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.Balance)
        );
    });

    it("round-trips SignedBlock", function () {
        const value = codecValues.signedBlock();
        const encoded = Codec.encode(value, Type.SignedBlock);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.SignedBlock)
        );
    });

    it("round-trips StateProof", function () {
        const value = codecValues.stateProof();
        const encoded = Codec.encode(value, Type.StateProof);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.StateProof)
        );
    });

    it("round-trips SyncPayload", function () {
        const value = codecValues.syncPayload();
        const encoded = Codec.encode(value, Type.SyncPayload);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, Type.SyncPayload)
        );
    });

    it("preserves uint256 values above Number.MAX_SAFE_INTEGER and canonical ABI bytes", function () {
        const value = { amount: ethers.MaxUint256, data: "0x1234" };
        const encoded = Codec.encode(value, Type.Balance);
        const canonical = ethers.AbiCoder.defaultAbiCoder().encode(
            ["tuple(uint256 amount, bytes data)"],
            [value]
        );

        expect(encoded).to.equal(canonical);
        expect(Codec.decode(encoded, Type.Balance)).to.deep.equal(value);
    });

    it("round-trips BlockDoubleSign fraud proof", function () {
        const value = codecValues.blockDoubleSignProof();
        const encoded = Codec.encode(value, FraudProofType.BlockDoubleSign);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, FraudProofType.BlockDoubleSign)
        );
    });

    it("round-trips BlockInvalidStateTransition fraud proof", function () {
        const value = codecValues.blockInvalidStateTransitionProof();
        const encoded = Codec.encode(
            value,
            FraudProofType.BlockInvalidStateTransition
        );
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, FraudProofType.BlockInvalidStateTransition)
        );
    });

    it("round-trips InvalidTimestamp fraud proof", function () {
        const value = codecValues.invalidTimestampProof();
        const encoded = Codec.encode(value, FraudProofType.InvalidTimestamp);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, FraudProofType.InvalidTimestamp)
        );
    });

    it("round-trips WrongGenesis fraud proof", function () {
        const value = codecValues.wrongGenesisProof();
        const encoded = Codec.encode(value, FraudProofType.WrongGenesis);
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, FraudProofType.WrongGenesis)
        );
    });

    it("round-trips ForgedInboundMessageBlock fraud proof", function () {
        const value = codecValues.forgedInboundMessageBlockProof();
        const encoded = Codec.encode(
            value,
            FraudProofType.ForgedInboundMessageBlock
        );
        expectCodecRoundTrip(
            value,
            encoded,
            Codec.decode(encoded, FraudProofType.ForgedInboundMessageBlock)
        );
    });

    it("round-trips DisputeNotLatestState fraud proof", function () {
        const value = codecValues.disputeNotLatestStateProof();
        const type = DisputeFraudProofType.DisputeNotLatestState;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips DisputeInvalidOutputState fraud proof", function () {
        const value = codecValues.disputeInvalidOutputStateProof();
        const type = DisputeFraudProofType.DisputeInvalidOutputState;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips DisputeInvalidStateProof fraud proof", function () {
        const value = codecValues.disputeInvalidStateProof();
        const type = DisputeFraudProofType.DisputeInvalidStateProof;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips DisputeInvalidBalanceInvariant fraud proof", function () {
        const value = codecValues.disputeInvalidBalanceInvariantProof();
        const type = DisputeFraudProofType.DisputeInvalidBalanceInvariant;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips DisputeOnChainSlashesNotSubset fraud proof", function () {
        const value = codecValues.booleanProof();
        const type = DisputeFraudProofType.DisputeOnChainSlashesNotSubset;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips TimeoutThreshold fraud proof", function () {
        const value = codecValues.timeoutThresholdProof();
        const type = DisputeFraudProofType.TimeoutThreshold;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips TimeoutCalldataPosted fraud proof", function () {
        const value = codecValues.timeoutCalldataPostedProof();
        const type = DisputeFraudProofType.TimeoutCalldataPosted;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips TimeoutNotLinkedToLatestState fraud proof", function () {
        const value = codecValues.booleanProof();
        const type = DisputeFraudProofType.TimeoutNotLinkedToLatestState;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips TimeoutParticipantNotNext fraud proof", function () {
        const value = codecValues.timeoutParticipantNotNextProof();
        const type = DisputeFraudProofType.TimeoutParticipantNotNext;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips TimeoutTooEarly fraud proof", function () {
        const value = codecValues.timeoutTooEarlyProof();
        const type = DisputeFraudProofType.TimeoutTooEarly;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips DisputeInvalidBlockInStateProofApplyFraudProof", function () {
        const value = codecValues.disputeInvalidBlockApplyFraudProof();
        const type =
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips DisputeLastMilestoneNotFinalAndNoAuditingData fraud proof", function () {
        const value = codecValues.booleanProof();
        const type =
            DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips InvalidDisputeReason fraud proof", function () {
        const value = codecValues.invalidDisputeReasonProof();
        const type = DisputeFraudProofType.InvalidDisputeReason;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips DisputeStateProofHeaderMismatch fraud proof", function () {
        const value = codecValues.booleanProof();
        const type = DisputeFraudProofType.DisputeStateProofHeaderMismatch;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips DisputeInboundHashNotInChain fraud proof", function () {
        const value = codecValues.booleanProof();
        const type = DisputeFraudProofType.DisputeInboundHashNotInChain;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips DisputeInvalidBlockStructure fraud proof", function () {
        const value = codecValues.disputeInvalidBlockStructureProof();
        const type = DisputeFraudProofType.DisputeInvalidBlockStructure;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("round-trips DisputeBlockAuthorNotParticipant fraud proof", function () {
        const value = codecValues.disputeBlockAuthorNotParticipantProof();
        const type = DisputeFraudProofType.DisputeBlockAuthorNotParticipant;
        const encoded = Codec.encode(value, type);
        expectCodecRoundTrip(value, encoded, Codec.decode(encoded, type));
    });

    it("decodes a primitive EVM return value without object conversion", function () {
        const returnValue = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256"],
            [91n]
        );

        expect(
            Codec.decodeEvmResult<bigint>({ returnValue }, "uint256")
        ).to.equal(91n);
    });

    it("decodes a dynamic EVM array without object conversion", function () {
        const returnValue = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address[]"],
            [[ethers.ZeroAddress, codecTestAddress]]
        );

        expect(
            Codec.decodeEvmResult<string[]>({ returnValue }, "address[]")
        ).to.deep.equal([ethers.ZeroAddress, codecTestAddress]);
    });

    it("decodes a named EVM tuple to an object by default", function () {
        const returnValue = ethers.AbiCoder.defaultAbiCoder().encode(
            ["tuple(uint256 amount, bool active)"],
            [[7n, true]]
        );

        expect(
            Codec.decodeEvmResult<{ amount: bigint; active: boolean }>(
                { returnValue },
                "tuple(uint256 amount, bool active)"
            )
        ).to.deep.equal({ amount: 7n, active: true });
    });

    it("rejects forced object conversion for a primitive EVM result", function () {
        const returnValue = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256"],
            [11n]
        );

        expect(() =>
            Codec.decodeEvmResult({ returnValue }, "uint256", {
                useObjectConversion: true
            })
        ).to.throw();
    });

    it("recursively converts nested named and unnamed ethers Results", function () {
        const coder = ethers.AbiCoder.defaultAbiCoder();
        const decoded = coder.decode(
            [
                "tuple(uint256 count, tuple(address owner, uint256 value) nested)"
            ],
            coder.encode(
                [
                    "tuple(uint256 count, tuple(address owner, uint256 value) nested)"
                ],
                [[3n, [ethers.ZeroAddress, 5n]]]
            )
        )[0];

        expect(Codec.convertEthersResultToObject(decoded)).to.deep.equal({
            count: 3n,
            nested: { owner: ethers.ZeroAddress, value: 5n }
        });

        const unnamed = coder.decode(
            ["tuple(uint256,address)"],
            coder.encode(["tuple(uint256,address)"], [[9n, codecTestAddress]])
        )[0];
        expect(Codec.convertEthersResultToObject(unnamed)).to.deep.equal([
            9n,
            codecTestAddress
        ]);

        const underscoreNamed = coder.decode(
            ["tuple(uint256 _)"],
            coder.encode(["tuple(uint256 _)"], [[4n]])
        )[0];
        expect(
            Codec.convertEthersResultToObject(underscoreNamed)
        ).to.deep.equal([4n]);
    });

    it("rejects malformed EVM return bytes and ABI schemas", function () {
        expect(() =>
            Codec.decodeEvmResult({ returnValue: "0x12" }, "uint256")
        ).to.throw();
        expect(() =>
            Codec.decodeEvmResult({ returnValue: "0x" }, "not an ABI type")
        ).to.throw();
    });

    it("throws for corrupt and truncated encoded structs", function () {
        expect(() => Codec.decode("0xinvaliddata", Type.Block)).to.throw();
        const encoded = Codec.encode(codecValues.block(), Type.Block);
        expect(() => Codec.decode(encoded.slice(0, -2), Type.Block)).to.throw();
    });

    it("adds type and bigint-safe value context to encode failures", function () {
        const encodeInvalidBalance = () =>
            Codec.encode(
                { amount: ethers.MaxUint256, data: "invalid" },
                Type.Balance
            );

        expect(encodeInvalidBalance).to.throw(
            "Codec.encode failed for Type.Balance"
        );
        expect(encodeInvalidBalance).to.throw(ethers.MaxUint256.toString());
    });

    it("rejects unmapped encode and decode type values", function () {
        expect(() => Reflect.apply(Codec.encode, Codec, [{}, 999])).to.throw(
            "No ethers type mapping found for 999"
        );
        expect(() => Reflect.apply(Codec.decode, Codec, ["0x", 999])).to.throw(
            "No ethers type mapping found for 999"
        );
    });
});
