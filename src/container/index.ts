export { Container, container } from "./Container";
export { registerService, registerEasyServices } from "./registerServices";
export type { ServiceName, ServiceRegistry } from "./types";
export { ServiceNames } from "./types";

// Type-safe inject function
import { ServiceRegistry } from "./types";
import { container } from "./Container";

export function inject<K extends keyof ServiceRegistry>(
    serviceName: K
): ServiceRegistry[K];
export function inject<T>(serviceName: string): T;
export function inject(serviceName: string): any {
    return container.resolve(serviceName);
}
