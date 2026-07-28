import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";

type ForceExitKey = "value";

export class ForceExitStorage {
    private readonly value: PersistentCollection<ForceExitKey, boolean>;

    constructor(controller?: PersistenceController) {
        this.value = new PersistentCollection("forceExit", controller);
    }

    public setForceExit(shouldForceExit: boolean): void {
        this.value.set("value", shouldForceExit);
    }

    public getForceExit(): boolean {
        return this.value.get("value") ?? false;
    }
}
