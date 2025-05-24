import localforage from "localforage";

/**
 * AgnosticStorage provides a simple key-value storage interface.
 * Completely wraps localStorage with memory caching for optimal performance.
 */
export class AgnosticStorage<T = any> {
    private memoryCache: Map<string, T> = new Map();
    private storage?: LocalForage;
    private isPersistent: boolean;
    private storeName: string;

    /**
     * Create a storage instance
     * @param options.persist - Whether to enable persistence (default: false)
     * @param options.storeName - Store name for persistence (default: 'default-store')
     */
    constructor(
        options: {
            persist?: boolean;
            storeName?: string;
        } = {}
    ) {
        this.isPersistent = options.persist ?? false;
        this.storeName = options.storeName ?? "default-store";

        if (this.isPersistent) {
            this.storage = localforage.createInstance({
                name: "state-channels-plus",
                storeName: this.storeName,
                driver: localforage.LOCALSTORAGE
            });
        }
    }

    /**
     * Initialize the storage (loads existing data if persistent)
     */
    async initialize(): Promise<void> {
        if (!this.isPersistent || !this.storage) {
            return;
        }

        try {
            const keys = await this.storage.keys();
            for (const key of keys) {
                const value = await this.storage.getItem<T>(key);
                if (value !== null) {
                    this.memoryCache.set(key, value);
                }
            }
        } catch (error) {
            console.warn("Failed to load existing data:", error);
        }
    }

    async set(
        key: string,
        value: T,
        options: { wait?: boolean } = {}
    ): Promise<void> {
        this.memoryCache.set(key, value);

        if (this.isPersistent && this.storage) {
            if (options.wait) {
                await this.storage.setItem(key, value);
            } else {
                this.storage.setItem(key, value).catch((error) => {
                    console.error(
                        "Background persistence failed for key:",
                        key,
                        error
                    );
                });
            }
        }
    }

    async get(key: string): Promise<T | null> {
        return this.memoryCache.get(key) ?? null;
    }

    async update(
        key: string,
        updater: (currentValue: T | null) => T,
        options: { wait?: boolean } = {}
    ): Promise<T> {
        const currentValue = this.memoryCache.get(key) ?? null;
        const newValue = updater(currentValue);
        await this.set(key, newValue, options);
        return newValue;
    }

    async remove(key: string, options: { wait?: boolean } = {}): Promise<void> {
        this.memoryCache.delete(key);

        if (this.isPersistent && this.storage) {
            if (options.wait) {
                await this.storage.removeItem(key);
            } else {
                this.storage.removeItem(key).catch((error) => {
                    console.error(
                        "Background remove failed for key:",
                        key,
                        error
                    );
                });
            }
        }
    }

    async clear(options: { wait?: boolean } = {}): Promise<void> {
        this.memoryCache.clear();

        if (this.isPersistent && this.storage) {
            if (options.wait) {
                await this.storage.clear();
            } else {
                this.storage.clear().catch((error) => {
                    console.error("Background clear failed:", error);
                });
            }
        }
    }

    async keys(): Promise<string[]> {
        return Array.from(this.memoryCache.keys());
    }

    async length(): Promise<number> {
        return this.memoryCache.size;
    }

    async has(key: string): Promise<boolean> {
        return this.memoryCache.has(key);
    }

    async entries(): Promise<[string, T][]> {
        return Array.from(this.memoryCache.entries());
    }

    async values(): Promise<T[]> {
        return Array.from(this.memoryCache.values());
    }

    // Force all memory data to localStorage
    async sync(): Promise<void> {
        if (!this.isPersistent || !this.storage) {
            return;
        }

        await this.storage.clear();

        for (const [key, value] of this.memoryCache.entries()) {
            await this.storage.setItem(key, value);
        }
    }

    getInfo(): {
        persistent: boolean;
        storeName: string;
        size: number;
    } {
        return {
            persistent: this.isPersistent,
            storeName: this.storeName,
            size: this.memoryCache.size
        };
    }
}
