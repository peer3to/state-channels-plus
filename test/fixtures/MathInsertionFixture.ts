// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import { transaction, buildAndEncodeBlock } from "../factory";
import { MathPeerTestHarness } from "./MathPeerTestHarness";
import { TransactionEthersType } from "@/types/ethers";
import { Codec, Type } from "@/utils";
import { decodeMathState, encodeMathState } from "@test/utils/mathHarnessAbi";
import { MathStateMachine__factory } from "@typechain-types";
import { ethers } from "ethers";

/** Executes the consumer against real session state and restores the VM afterward. */
export async function probeMathInsertion(
    h: MathPeerTestHarness,
    options: {
        maximum?: number;
        amount: bigint;
        fullBalance?: boolean;
        target?: "zero" | "self" | "existing";
        author?: "wrong-turn" | "outsider";
        zeroAuthorBalance?: boolean;
        turnIndex?: number;
        oversized?: boolean;
        repeat?: number;
    }
) {
    const maximum = options.maximum ?? 3;
    // The networking fixture requires two peers; N=1 exercises its real
    // consumer VM without trying to open a two-participant channel.
    if (maximum === 1)
        await h.setup(2, {
            maxChannelParticipants: maximum,
            autoConnect: false
        });
    else await h.lifecycle.start(2, 0, { maxChannelParticipants: maximum });
    const peer = h.getPeer(0);
    const { encodedState } = await h.execOnHost(peer, async (sm) => ({
        encodedState: String(await sm.diamondStateMachine.getState())
    }));
    const initial = decodeMathState(encodedState);
    if (maximum === 1) {
        initial.participants = [peer.address];
        initial.balances = [0n];
    }
    if (options.oversized) {
        initial.participants.push(ethers.Wallet.createRandom().address);
        initial.balances.push(0n);
    }
    if (options.turnIndex !== undefined)
        initial.currentTurnIndex = BigInt(options.turnIndex);
    const authorIndex = Number(
        initial.currentTurnIndex % BigInt(initial.participants.length)
    );
    if (options.zeroAuthorBalance) initial.balances[authorIndex] = 0n;
    const target =
        options.target === "zero"
            ? ethers.ZeroAddress
            : options.target === "self"
              ? initial.participants[authorIndex]
              : options.target === "existing"
                ? initial.participants[
                      (authorIndex + 1) % initial.participants.length
                  ]
                : ethers.Wallet.createRandom().address;
    const author =
        options.author === "outsider"
            ? ethers.Wallet.createRandom().address
            : options.author === "wrong-turn"
              ? initial.participants[
                    (authorIndex + 1) % initial.participants.length
                ]
              : initial.participants[authorIndex];
    const call = MathStateMachine__factory.createInterface().encodeFunctionData(
        "insertParticipantOffChain",
        [
            target,
            options.fullBalance ? initial.balances[authorIndex] : options.amount
        ]
    );
    const tx = transaction({
        header: {
            ...transaction().header,
            channelId: h.channelId ?? ethers.ZeroHash,
            forkId: h.activeForkId ?? ethers.ZeroHash,
            participant: author
        },
        body: { ...transaction().body, data: call }
    });
    const result = await h.execOnHost(
        peer,
        async (sm, args, { ethers }) =>
            sm.withMutex(
                async () => {
                    const machine = sm.diamondStateMachine;
                    const originalState = await machine.getState();
                    try {
                        await machine.setState(args.encodedInitialState);
                        const beforeBalance =
                            await machine.getTotalStateBalance();
                        const snapshot = sm.storage.getStateSnapshot({
                            forkId: sm.forkId,
                            height:
                                sm.storage.blocks.getNextBlockHeight(
                                    sm.forkId
                                ) - 1
                        });
                        const inboundBefore =
                            snapshot?.snapshotData
                                .latestInboundMessageBlockHash;
                        const [tx] = ethers.AbiCoder.defaultAbiCoder().decode(
                            [args.transactionType],
                            args.encodedTransaction
                        );
                        const successes: boolean[] = [];
                        const outboundCounts: number[] = [];
                        for (let index = 0; index < args.repeat; index++) {
                            const nextTx = {
                                header: {
                                    ...tx.header.toObject(),
                                    participant: index
                                        ? await machine.getNextToWrite()
                                        : tx.header.participant
                                },
                                body: tx.body.toObject()
                            };
                            const result =
                                await machine.stateTransition(nextTx);
                            successes.push(result.success);
                            outboundCounts.push(result.outboundMessages.length);
                        }
                        const afterBalance =
                            await machine.getTotalStateBalance();
                        return {
                            encodedAfter: String(await machine.getState()),
                            beforeBalance: String(beforeBalance.amount),
                            afterBalance: String(afterBalance.amount),
                            successes,
                            outboundCounts,
                            nextToWrite: String(await machine.getNextToWrite()),
                            inboundBefore: String(inboundBefore),
                            inboundAfter: String(
                                sm.storage.getStateSnapshot({
                                    forkId: sm.forkId,
                                    height:
                                        sm.storage.blocks.getNextBlockHeight(
                                            sm.forkId
                                        ) - 1
                                })?.snapshotData.latestInboundMessageBlockHash
                            ),
                            queueMaximum:
                                sm.storage.queues.maxChannelParticipants
                        };
                    } finally {
                        await machine.setState(originalState);
                    }
                },
                { taskName: "MathInsertionFixture.probe" }
            ),
        {
            encodedInitialState: encodeMathState(initial),
            encodedTransaction: String(Codec.encode(tx, Type.Transaction)),
            transactionType: TransactionEthersType,
            repeat: options.repeat ?? 1
        }
    );
    return {
        ...result,
        before: initial,
        after: decodeMathState(result.encodedAfter),
        target,
        authorIndex,
        maximum
    };
}

/** Exercise the SDK author guard before the insertion reaches the local VM. */
export async function assertInsertionWrongAuthor(h: MathPeerTestHarness) {
    await h.lifecycle.start(2, 1, { maxChannelParticipants: 3 });
    const author = await h.query.getNextPeerToWrite();
    const wrong = h.peers.find((peer) => peer.address !== author.address)!;
    const target = ethers.Wallet.createRandom().address;
    const before = await h.execOnHost(
        wrong,
        async (sm, args) => ({
            encodedState: String(await sm.diamondStateMachine.getState()),
            height: sm.storage.blocks.getNextBlockHeight(sm.forkId),
            eligibility: sm.membershipService.getCachedSourceEligibility(
                args.target
            )
        }),
        { target }
    );
    let error = "";
    try {
        await wrong.p2pInstance.p2pContractInstance.insertParticipantOffChain(
            target,
            0n
        );
    } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
    }
    const after = await h.execOnHost(
        wrong,
        async (sm, args) => ({
            encodedState: String(await sm.diamondStateMachine.getState()),
            height: sm.storage.blocks.getNextBlockHeight(sm.forkId),
            eligibility: sm.membershipService.getCachedSourceEligibility(
                args.target
            )
        }),
        { target }
    );
    return { before, after, error };
}

export async function probeWrongLeaderInsertion(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 2);
    const observer = h.getPeer(0);
    const next = await h.query.getNextPeerToWrite();
    const author = h.peers.find((peer) => peer.address !== next.address)!;
    const previous = await h
        .control(observer)
        .query.getBlockByHeight(h.activeForkId!, 1)
        .request();
    const target = ethers.Wallet.createRandom().address;
    const encodedBlock = await buildAndEncodeBlock(author.signer, {
        header: {
            channelId: h.channelId,
            forkId: h.activeForkId!,
            transactionCnt: 2,
            participant: author.address
        },
        transaction: transaction({
            body: {
                ...transaction().body,
                data: MathStateMachine__factory.createInterface().encodeFunctionData(
                    "insertParticipantOffChain",
                    [target, 0n]
                )
            }
        }),
        previousBlockHash: previous!.hash
    });
    const read = () =>
        h.execOnHost(
            observer,
            async (sm, args) => ({
                encodedState: String(await sm.diamondStateMachine.getState()),
                height: sm.storage.blocks.getNextBlockHeight(sm.forkId),
                eligibility: sm.membershipService.getCachedSourceEligibility(
                    args.target
                )
            }),
            { target }
        );
    const before = await read();
    const validation = await h
        .control(observer)
        .validation.runBlockValidation(encodedBlock)
        .request();
    return { before, after: await read(), validation };
}
