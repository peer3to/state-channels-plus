class Mutex {
    private isLocked: boolean;
    private queue: (() => void)[];

    constructor() {
        this.isLocked = false;
        this.queue = [];
    }

    public lock(): Promise<void> {
        return new Promise((resolve) => {
            if (this.isLocked) {
                this.queue.push(resolve);
            } else {
                this.isLocked = true;
                resolve();
            }
        });
    }

    public unlock(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) {
                next();
            }
        } else {
            this.isLocked = false;
        }
    }
}

export default Mutex;
