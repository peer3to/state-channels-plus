import type MathPeerTestHarness from "@test/fixtures/MathPeerTestHarness";
import type { SeededRng, Weighted } from "@test/utils/SeededRng";

export interface FuzzAction extends Weighted {
    name: string;
    enabled: (ctx: { h: MathPeerTestHarness; rng: SeededRng }) => boolean;
    run: (ctx: { h: MathPeerTestHarness; rng: SeededRng }) => Promise<void>;
}

export async function runFuzzCampaign(
    ctx: { h: MathPeerTestHarness; rng: SeededRng },
    menu: FuzzAction[],
    steps: number,
    afterStep: () => Promise<void>
): Promise<Record<string, number>> {
    const ranCount: Record<string, number> = {};
    for (let step = 0; step < steps; step++) {
        const action = ctx.rng.weightedPick(menu.filter((a) => a.enabled(ctx)));
        // eslint-disable-next-line no-console
        console.log(`[fuzz] step ${step + 1}/${steps}: ${action.name}`);
        await action.run(ctx);
        ranCount[action.name] = (ranCount[action.name] ?? 0) + 1;
        await afterStep();
    }
    return ranCount;
}
