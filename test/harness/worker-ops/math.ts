// step 1 - math state-machine worker ops. mirrors the lambda calls test source
// makes today (e.g. `(contract) => contract.add(1)`). orchestrator -> worker
// ships {op: 'math.<name>', args: [...]} -> worker invokes
// `p2pInstance.p2pContractInstance.<methodName>(...args)`.
//
// inline path runs the same ops in-process (one body, two backends).

import {
    registerOp,
    type WorkerOpContext
} from "../threaded/worker/opsRegistry";

type MathContract = {
    add(value: number | bigint): Promise<unknown>;
    sub(value: number | bigint): Promise<unknown>;
    set(value: number | bigint): Promise<unknown>;
    leaveChannel(): Promise<unknown>;
};

function getContract(ctx: WorkerOpContext): MathContract {
    if (!ctx.getP2pInstance) {
        throw new Error(
            "math op: WorkerOpContext.getP2pInstance not wired in this isolate"
        );
    }
    const p2p = ctx.getP2pInstance() as {
        p2pContractInstance: MathContract;
    };
    return p2p.p2pContractInstance;
}

registerOp<{ value?: number | bigint }, unknown>(
    "math.add",
    async (ctx, args) => {
        const value = args?.value ?? 1;
        return await getContract(ctx).add(value);
    }
);

registerOp<{ value?: number | bigint }, unknown>(
    "math.sub",
    async (ctx, args) => {
        const value = args?.value ?? 1;
        return await getContract(ctx).sub(value);
    }
);

registerOp<{ value: number | bigint }, unknown>(
    "math.set",
    async (ctx, args) => {
        return await getContract(ctx).set(args.value);
    }
);

registerOp<undefined, unknown>("math.leaveChannel", async (ctx) => {
    return await getContract(ctx).leaveChannel();
});
