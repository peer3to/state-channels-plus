import { container } from "./Container";
import { ServiceNames } from "./types";

import Storage from "@/storage";
import AgreementManager from "@/agreementManager";

export function registerService<T>(
    serviceName: string,
    serviceInstance: T
): void {
    container.register(serviceName, () => serviceInstance);
}

/**
 * Register "easy" services that have no runtime dependencies
 * These services either:
 * - Have no constructor arguments
 * - Only depend on other injectable services
 *
 */
export function registerEasyServices(): void {
    // Core Services with no runtime dependencies
    container.register(ServiceNames.STORAGE, () => new Storage());
    container.register(
        ServiceNames.AGREEMENT_MANAGER,
        () => new AgreementManager()
    );
}

/**
 * Dispose of all services that require cleanup
//  */
// export async function disposeServices(): Promise<void> {
//     const serviceNames = container.getRegisteredServices();

//     for (const serviceName of serviceNames.reverse()) {
//         try {
//             const service = container.resolve(serviceName);
//             if (service && typeof service === 'object' && 'dispose' in service && typeof service.dispose === 'function') {
//                 await service.dispose();
//             }
//         } catch (error) {
//             console.error(`Error disposing service ${serviceName}:`, error);
//         }
//     }

//     container.clear();
// }
