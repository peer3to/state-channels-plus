export class ForceExitStorage {
    private shouldIForceExit = false;

    setForceExit(shouldForceExit: boolean): void {
        this.shouldIForceExit = shouldForceExit;
    }
    getForceExit(): boolean {
        return this.shouldIForceExit;
    }
}
