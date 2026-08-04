import { MathTestSession as TestSession } from "@test/harness";
import { SeededRng } from "@test/utils/SeededRng";
import { runFuzzCampaign } from "./fuzz/FuzzAction";
import { DISPUTE_SOUNDNESS_MENU } from "./fuzz/disputeSoundnessMenu";

/**
 * fuzz test: Each run draws a seed (override: SEED=<n>),
 * drives the protocol through honest state evolution + randomized byzantine attacks, and checks
 * the invariant after every step: surviving honest peers stay in sync, attackers are removed.
 * Reproducibility: seed + config are logged up front; replay with SEED=<n> yarn test:e2e.
 */

const FAST_TIME = {
    p2pTime: 1,
    agreementTime: 6,
    chainFallbackTime: 2,
    evidenceTime: 6
};
const REPS = Number(process.env.REPS ?? "1");

describe("E2E: Fuzz - dispute soundness under randomized state evolution", function () {
    for (let rep = 1; rep <= REPS; rep++) {
        it(`rep ${rep}/${REPS}: survivors stay in sync; every attack is contained without honest loss`, async function () {
            const h = TestSession.getHarness();

            const rng = SeededRng.fromEnv();
            const peers = rng.int(4, 6);
            const steps = rng.int(8, 14);
            // eslint-disable-next-line no-console
            console.log(
                `[fuzz] rep=${rep}/${REPS} seed=${rng.seed} peers=${peers} steps=${steps}  (re-run: SEED=${rng.seed} yarn test:e2e:log-file --grep "dispute soundness")`
            );

            await h.lifecycle.start(peers, 1, { timeConfig: FAST_TIME });
            await h.assert.sync.peersInSyncWait();

            const ran = await runFuzzCampaign(
                { h, rng },
                DISPUTE_SOUNDNESS_MENU,
                steps,
                () => h.assert.sync.onlyHonestPeersInSync()
            );

            // eslint-disable-next-line no-console
            console.log(
                `[fuzz] DONE rep=${rep}/${REPS} seed=${rng.seed}: ${JSON.stringify(ran)}, ${h.getActiveHonestPeers().length} honest survivors in sync`
            );
        });
    }
});
