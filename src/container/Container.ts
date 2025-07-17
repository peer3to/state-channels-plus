export class Container {
    private services = new Map<string, any>();
    private factories = new Map<string, () => any>();
    private mocks = new Map<string, any>();
    private parent?: Container; // For scoped containers

    constructor(parent?: Container) {
        this.parent = parent;
    }

    register(name: string, factory: () => any): void {
        if (this.factories.has(name)) {
            throw new Error(`Service "${name}" is already registered`);
        }
        this.factories.set(name, factory);
    }

    resolve<T>(name: string): T {
        // Check if we have a mock for this service
        if (this.mocks.has(name)) {
            return this.mocks.get(name);
        }

        // Check if it's already instantiated (singleton)
        if (this.services.has(name)) {
            return this.services.get(name);
        }

        // Get the factory
        const factory = this.factories.get(name);
        if (!factory) {
            throw new Error(`Service "${name}" is not registered`);
        }

        // Create the service instance
        const instance = factory();

        // Store as singleton
        this.services.set(name, instance);

        return instance;
    }

    /**
     * Mock a service for testing
     */
    mock<T>(name: string, mock: T): void {
        this.mocks.set(name, mock);
    }

    /**
     * Clear all mocks
     */
    clearMocks(): void {
        this.mocks.clear();
    }

    /**
     * Get all registered service names
     */
    getRegisteredServices(): string[] {
        return Array.from(this.factories.keys());
    }

    /**
     * Check if a service is registered
     */
    has(name: string): boolean {
        return this.factories.has(name) || (this.parent?.has(name) ?? false);
    }

    /**
     * Clear all services and factories
     */
    clear(): void {
        this.services.clear();
        this.factories.clear();
        this.mocks.clear();
    }
}

// Global container instance
export const container = new Container();
