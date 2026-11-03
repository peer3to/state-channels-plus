import MirrorRpcProvider from "@/evm/p2pRuntime/rpcNodes/MirrorRpcProvider";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import { sleep } from "@/utils";
import { createLogger } from "@/utils/logging";
import {
    ABSENCE_WINDOW_MS,
    values,
    watchEmitter
} from "@test/fixtures/node/LogFeedFixture";
import {
    headNumber,
    serviceRequests,
    withMirrorSession
} from "@test/fixtures/node/RpcMirrorFixture";
import {
    deployLogEmitter,
    emitValue,
    VALUE_SET_TOPIC
} from "@test/fixtures/node/StorageDiffContracts";
import { recordUnhandledRejections } from "@test/fixtures/UnhandledRejectionRecorder";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/** The tests below keep what the node-socket relay of logs guaranteed, now on the service path. */
describe("Log feed lifecycle", function () {
    it("hands on each log once and subscribes again when the service connection is cut and restored", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const watch = watchEmitter(
                session,
                emitter,
                (await headNumber(session)) + 1
            );
            await emitValue(session.signer, emitter, 1n);
            await waitFor(() => watch.logs.length === 1);
            const subscribed = serviceRequests(
                session,
                "scp_subscribeContractStorage"
            ).length;

            session.service.cut();
            session.service.restore();
            await emitValue(session.signer, emitter, 2n);

            await waitFor(() => watch.logs.length >= 2);
            await sleep(ABSENCE_WINDOW_MS);
            expect(values(watch)).to.deep.equal([1n, 2n]);
            expect(
                serviceRequests(session, "scp_subscribeContractStorage")
            ).to.have.length.greaterThan(subscribed);
            watch.stop();
        });
    });

    it("does not reopen the service connection after the last log watch is gone", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const watch = watchEmitter(
                session,
                emitter,
                (await headNumber(session)) + 1
            );
            await waitFor(
                () =>
                    serviceRequests(session, "scp_getContractStorageDiffs")
                        .length > 0
            );
            // with a watch the connection is reopened after a loss
            const connected = serviceRequests(
                session,
                "scp_subscribeContractStorage"
            ).length;
            session.service.cut();
            session.service.restore();
            await waitFor(
                () =>
                    serviceRequests(session, "scp_subscribeContractStorage")
                        .length > connected
            );

            watch.stop();
            await sleep(ABSENCE_WINDOW_MS);
            const asked = session.service.forwardedRequests.length;
            session.service.cut();
            session.service.restore();

            await sleep(3 * ABSENCE_WINDOW_MS);
            expect(session.service.forwardedRequests).to.have.length(asked);
        });
    });

    it("closes its sockets to the service and to the node when it is destroyed with a log watch and a block subscription, and leaves no unhandled rejection", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const recorder = recordUnhandledRejections();
            try {
                await session.provider.on("block", () => undefined);
                watchEmitter(session, emitter, (await headNumber(session)) + 1);
                await waitFor(
                    () =>
                        serviceRequests(session, "scp_getContractStorageDiffs")
                            .length > 0
                );
                expect(session.service.openSockets).to.be.greaterThan(0);
                expect(session.node.openSockets).to.be.greaterThan(0);

                session.provider.destroy();
                await sleep(ABSENCE_WINDOW_MS);

                // Mutation: `mirror.close()` removed in destroy, the service socket stays open
                expect(session.service.openSockets).to.equal(0);
                expect(session.node.openSockets).to.equal(0);
                expect(await recorder.settled()).to.deep.equal([]);
            } finally {
                recorder.stop();
            }
        });
    });

    it("stops retrying a log read that was in flight when the provider was destroyed", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const logger = createLogger(
                {},
                {},
                { level: "error", attachErrorListener: false }
            );
            // record-only: counts the feed's failed-read warnings
            let failedReads = 0;
            const countFailedReads = (target: typeof logger) => {
                const warn = target.warn.bind(target);
                target.warn = (message: unknown, ...meta: unknown[]) => {
                    if (String(message).includes("Log read failed"))
                        failedReads++;
                    warn(message, ...meta);
                };
            };
            // the feed logs through a child of the provider's logger
            const child = logger.child.bind(logger);
            logger.child = (context) => {
                const made = child(context);
                countFailedReads(made);
                return made;
            };
            const rpcNode = new RpcNodeProvider(session.node.url, logger);
            const provider = new MirrorRpcProvider([rpcNode], logger, {
                storageDiffUrl: session.service.url
            });
            try {
                await rpcNode.firstAttempt;
                const held = session.service.holdReplies(
                    "scp_getContractStorageDiffs"
                );
                provider.logs.watch(
                    { address: emitter, topics: [VALUE_SET_TOPIC] },
                    (await headNumber(session)) + 1,
                    () => undefined
                );
                await waitFor(() => held.heldReplies() === 1);

                provider.destroy();
                await sleep(6 * ABSENCE_WINDOW_MS);

                // Mutation: `logFeed.close()` removed in destroy, the read retries on a closed mirror
                expect(failedReads).to.be.lessThan(2);
                held.release();
            } finally {
                provider.destroy();
                logger.dispose();
            }
        });
    });

    it("keeps handing on logs while every node is cut", async function () {
        await withMirrorSession(async (session) => {
            const emitter = await deployLogEmitter(session.signer);
            const watch = watchEmitter(
                session,
                emitter,
                (await headNumber(session)) + 1
            );
            session.node.cut();
            await waitFor(() => !session.rpcNode.isConnected);

            await emitValue(session.signer, emitter, 4n);

            await waitFor(() => watch.logs.length >= 1);
            // Mutation: `await this.readNodeHead()` first in LogWatch.readLatest, no log arrives
            expect(values(watch)).to.deep.equal([4n]);
            watch.stop();
        });
    });
});
