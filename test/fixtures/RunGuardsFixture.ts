// @spec-test-coverage-ignore: concrete guard collaborators for runGuards component tests
import type ARpcService from "@/rpc/ARpcService";
import type ARpcMethods from "@/rpc/ARpcMethods";
import { AGuard } from "@/rpc/guards/AGuard";
import type Rpc from "@/rpc/Rpc";
import type ATransport from "@/transport/ATransport";

class RecordingGuard extends AGuard {
    constructor(
        private readonly label: string,
        private readonly passes: boolean,
        private readonly events: string[]
    ) {
        super(undefined as unknown as ARpcService<ARpcMethods>);
    }

    public check(): boolean {
        this.events.push(`check:${this.label}`);
        return this.passes;
    }

    public onFailure(): void {
        this.events.push(`failure:${this.label}`);
    }
}

export class RunGuardsFixture {
    public readonly rpc: Rpc = {
        service: "guardProbe",
        method: "run",
        params: []
    };
    public readonly transport = undefined as unknown as ATransport;
    public readonly events: string[] = [];

    public guards(...passes: boolean[]): AGuard[] {
        return passes.map(
            (pass, index) =>
                new RecordingGuard(String(index + 1), pass, this.events)
        );
    }
}
