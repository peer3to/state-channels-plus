export class ForceExitStorage {
    private shouldIForceExit = false;

    setForceExit(shouldForceExit: boolean): void {
        this.shouldIForceExit = shouldForceExit;
    }
    getForceExit(): boolean {
        return this.shouldIForceExit;
    }

    // ====================================
    // PERSISTENCE (singletonSchema accessor)
    // ====================================

    /** false is the default/cleared state, so it is treated as unset. */
    getValue(): boolean | undefined {
        return this.shouldIForceExit || undefined;
    }

    setValue(value: boolean): void {
        this.shouldIForceExit = value;
    }
}
