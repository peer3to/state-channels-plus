// W1 §6 bucket (iii) - named-op registry acceptance.
//
// register one op, call it via submitNext on an InlinePeer, assert it ran
// with the right args. covers both the registry + the inline path. worker
// path is exercised in the e2e suite once W5 lands; the rpc surface is
// already wired (transition.runOp registered in worker entry).

import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";

import { InlinePeer } from "@test/harness/core/InlinePeer";
import {
    registerOp,
    _resetOpsRegistryForTests,
    hasOp,
    listOps,
    WorkerOpAlreadyRegisteredError,
    WorkerOpNotFoundError
} from "@test/harness/threaded/worker/opsRegistry";
import type { TestPeer } from "@test/harness/core/types";

describe("W1 §6 bucket (iii) named-op registry", () => {
    beforeEach(() => {
        // step 1 - tests share a process-wide registry; isolate per test so
        // duplicate-registration assertions don't bleed.
        _resetOpsRegistryForTests();
    });

    it("registerOp + getOp round-trip + inline submitNext runs the op", async () => {
        // step 1 - register a math op that reads the stateManager via the ctx.
        // here the inline stateManager is a stand-in object; the op contract is
        // "consume ctx + args, do stuff, return". real domain ops will reach
        // into the live stateManager once W5 lands.
        registerOp("mathContractAdd", async (ctx, args) => {
            const { n } = args as { n: number };
            const sm = ctx.getStateManager() as { offset: number };
            return sm.offset + n;
        });

        expect(hasOp("mathContractAdd")).to.equal(true);
        expect(listOps()).to.include("mathContractAdd");

        // step 1 - InlinePeer wraps a stand-in record whose stateManager
        // exposes `offset: 10`. the op reads it through ctx.
        const stand: Partial<TestPeer> = {
            index: 0,
            address: "0x",
            signer: {} as never,
            logger: {} as never,
            eventSpies: {},
            turnBarrier: {} as never,
            stateManager: { offset: 10 } as never,
            p2pInstance: { dispose: async () => undefined } as never
        };
        const peer = new InlinePeer(stand as TestPeer);

        // step 1 - call via the named-op transition surface. {op, args} shape.
        const result = await peer.transition.submitNext({
            op: "mathContractAdd",
            args: { n: 5 }
        });
        expect(result).to.equal(15);
    });

    it("submitNext on an unknown op throws WorkerOpNotFoundError", async () => {
        const stand: Partial<TestPeer> = {
            index: 0,
            address: "0x",
            signer: {} as never,
            logger: {} as never,
            eventSpies: {},
            turnBarrier: {} as never,
            stateManager: {} as never,
            p2pInstance: { dispose: async () => undefined } as never
        };
        const peer = new InlinePeer(stand as TestPeer);
        let caught: Error | undefined;
        try {
            await peer.transition.submitNext({
                op: "doesNotExist",
                args: {}
            });
        } catch (e) {
            caught = e as Error;
        }
        expect(caught).to.be.instanceOf(WorkerOpNotFoundError);
        expect(caught?.message).to.include("doesNotExist");
    });

    it("duplicate registerOp throws WorkerOpAlreadyRegisteredError", () => {
        registerOp("dupOp", () => 1);
        expect(() => registerOp("dupOp", () => 2)).to.throw(
            WorkerOpAlreadyRegisteredError
        );
    });

    it("function-typed txFn rejected at runtime with migration error", async () => {
        const stand: Partial<TestPeer> = {
            index: 0,
            address: "0x",
            signer: {} as never,
            logger: {} as never,
            eventSpies: {},
            turnBarrier: {} as never,
            stateManager: {} as never,
            p2pInstance: { dispose: async () => undefined } as never
        };
        const peer = new InlinePeer(stand as TestPeer);
        let caught: Error | undefined;
        try {
            // step 1 - simulate a legacy lambda overload sneaking through.
            // runtime guard backstops the write-time lint.
            const legacyShape = {
                op: "x",
                txFn: () => undefined
            } as unknown as { op: string };
            await peer.transition.submitNext(legacyShape);
        } catch (e) {
            caught = e as Error;
        }
        expect(caught).to.be.instanceOf(Error);
        expect(caught!.message).to.include("function-typed 'txFn'");
        expect(caught!.message).to.include("named-op shape");
    });
});
