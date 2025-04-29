export class BarrierLocal {
    private static instance: BarrierLocal;
    private count: number;
    private queue: (() => void)[];

    private constructor() {
        this.count = 0;
        this.queue = [];
    }
    public static createNewInstance(): BarrierLocal {
        return new BarrierLocal();
    }
    public static getInstance(): BarrierLocal {
        if (!BarrierLocal.instance) {
            BarrierLocal.instance = new BarrierLocal();
        }
        return BarrierLocal.instance;
    }

    public tryPass(): Promise<void> {
        if (this.count > 0) {
            this.count--;
            return Promise.resolve();
        } else {
            return new Promise<void>((resolve) => {
                this.queue.push(resolve);
            });
        }
    }

    public allowOne(): void {
        if (this.queue.length > 0) {
            const resolve = this.queue.shift();
            resolve?.();
        } else this.count++;
    }
}
