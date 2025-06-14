export interface P2PConnectivityInfo {
    canHolePunch: boolean;
    connectivityType:
        | "ipv6_public"
        | "cone_nat"
        | "symmetric_nat"
        | "blocked"
        | "unknown";
    natType?: "cone" | "symmetric" | "blocked" | "unknown"; // Only present if behind NAT
    externalIPs: string[];
    externalPorts: number[];
    isUDPBlocked: boolean;
    hasIPv6: boolean;
    details: string; // Human readable explanation
}

export enum PeerEnvironment {
    BROWSER,
    NODE,
    UNSUPPORTED
}

function detectEnvironment(): PeerEnvironment {
    if (typeof window !== "undefined") {
        if (typeof window.RTCPeerConnection !== "undefined") {
            return PeerEnvironment.BROWSER;
        } else {
            return PeerEnvironment.UNSUPPORTED;
        }
    } else if (
        typeof process !== "undefined" &&
        process.versions &&
        process.versions.node
    ) {
        return PeerEnvironment.NODE;
    } else {
        return PeerEnvironment.UNSUPPORTED;
    }
}

export class P2PConnectivityService {
    private stunServers: string[] = [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
        "stun:stun3.l.google.com:19302"
    ];

    public async detectP2PCapability(): Promise<P2PConnectivityInfo> {
        try {
            const results = await this.detectExternalNetworkAddress();
            return this.analyzeResults(results);
        } catch (error) {
            console.error(`P2P connectivity detection failed:`, error);
            return {
                canHolePunch: false,
                connectivityType: "unknown",
                natType: "unknown",
                externalIPs: [],
                externalPorts: [],
                isUDPBlocked: true,
                hasIPv6: false,
                details: `detection failed: ${error}`
            };
        }
    }

    // Browser-specific detection using WebRTC
    private async detectExternalNetworkAddress(): Promise<
        Array<{ ip: string; port: number; server: string }>
    > {
        const allResults: Array<{ ip: string; port: number; server: string }> =
            [];

        const environment = detectEnvironment();

        if (environment === PeerEnvironment.UNSUPPORTED) {
            throw new Error(
                "Unsupported environment - cannot perform NAT detection"
            );
        }

        const detectionFunction =
            environment === PeerEnvironment.BROWSER
                ? this.testSTUNBrowser.bind(this)
                : this.testSTUNNode.bind(this);

        for (const stunServer of this.stunServers) {
            try {
                const result = await detectionFunction(stunServer);
                if (result) {
                    allResults.push({ ...result, server: stunServer });
                }
            } catch (error) {
                console.warn(`STUN server ${stunServer} failed:`, error);
            }
        }
        return allResults;
    }

    // Browser STUN testing using WebRTC
    private async testSTUNBrowser(
        stunServer: string
    ): Promise<{ ip: string; port: number } | null> {
        return new Promise((resolve) => {
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: stunServer }]
            });
            let done = false;
            let result: { ip: string; port: number } | null = null;

            const cleanup = () => pc.close();

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    const c = event.candidate;
                    if (c.type === "srflx" && c.address && c.port && !result) {
                        result = { ip: c.address, port: c.port };
                    }
                } else {
                    if (!done) {
                        done = true;
                        cleanup();
                        resolve(result);
                    }
                }
            };

            pc.createDataChannel("singleTest");
            pc.createOffer()
                .then((offer) => pc.setLocalDescription(offer))
                .catch(() => {
                    if (!done) {
                        done = true;
                        cleanup();
                        resolve(null);
                    }
                });

            setTimeout(() => {
                if (!done) {
                    done = true;
                    cleanup();
                    resolve(result);
                }
            }, 5000);
        });
    }

    // Node.js STUN testing
    private async testSTUNNode(
        stunServer: string
    ): Promise<{ ip: string; port: number } | null> {
        try {
            const stun = require("stun");

            const response = await stun.request(stunServer);
            const { address, port } = response.getXorAddress();
            return {
                ip: address,
                port: port
            };
        } catch (error) {
            console.warn(`STUN library test failed for ${stunServer}:`, error);
            return null;
        }
    }

    private isIPv6(ip: string): boolean {
        return ip.includes(":");
    }

    private isGlobalUnicastIPv6 = (ip: string): boolean => {
        if (!this.isIPv6(ip)) return false;
        const firstChar = ip.charAt(0).toLowerCase();
        return firstChar === "2" || firstChar === "3";
    };

    private analyzeResults(
        results: Array<{ ip: string; port: number; server: string }>
    ): P2PConnectivityInfo {
        if (results.length === 0) {
            return {
                canHolePunch: false,
                connectivityType: "blocked",
                natType: "blocked",
                externalIPs: [],
                externalPorts: [],
                isUDPBlocked: true,
                hasIPv6: false,
                details:
                    "No server-reflexive candidates found - UDP likely blocked"
            };
        }

        const uniqueIPs = [...new Set(results.map((r) => r.ip))];
        const uniquePorts = [...new Set(results.map((r) => r.port))];
        const hasIPv6 = uniqueIPs.some(this.isIPv6);
        const hasGlobalIPv6 = uniqueIPs.some(this.isGlobalUnicastIPv6);

        // IPv6 Global Unicast = BEST CASE!
        if (hasGlobalIPv6) {
            const ipv6IPs = uniqueIPs.filter(this.isGlobalUnicastIPv6);
            return {
                canHolePunch: true,
                connectivityType: "ipv6_public",
                externalIPs: uniqueIPs,
                externalPorts: uniquePorts,
                isUDPBlocked: false,
                hasIPv6: true,
                details: `Global unicast IPv6 detected [${ipv6IPs.join(", ")}] - no NAT, excellent hole-punching capability!`
            };
        }

        // Same IP and same port = Cone NAT
        if (uniqueIPs.length === 1 && uniquePorts.length === 1) {
            return {
                canHolePunch: true,
                connectivityType: "cone_nat",
                natType: "cone",
                externalIPs: uniqueIPs,
                externalPorts: uniquePorts,
                isUDPBlocked: false,
                hasIPv6,
                details: `Consistent external endpoint ${uniqueIPs[0]}:${uniquePorts[0]} across all servers - cone NAT behavior`
            };
        }

        // Same IP but different ports = Symmetric NAT
        if (uniqueIPs.length === 1 && uniquePorts.length > 1) {
            return {
                canHolePunch: false,
                connectivityType: "symmetric_nat",
                natType: "symmetric",
                externalIPs: uniqueIPs,
                externalPorts: uniquePorts,
                isUDPBlocked: false,
                hasIPv6,
                details: `Same external IP ${uniqueIPs[0]} but different ports [${uniquePorts.join(", ")}] - symmetric NAT allocates ports per destination`
            };
        }

        // Multiple external IPs = Complex setup
        if (uniqueIPs.length > 1) {
            return {
                canHolePunch: false,
                connectivityType: "symmetric_nat",
                natType: "symmetric",
                externalIPs: uniqueIPs,
                externalPorts: uniquePorts,
                isUDPBlocked: false,
                hasIPv6,
                details: `Multiple external IPs detected [${uniqueIPs.join(", ")}] - complex network setup, treating as symmetric for safety`
            };
        }

        return {
            canHolePunch: false,
            connectivityType: "unknown",
            natType: "unknown",
            externalIPs: uniqueIPs,
            externalPorts: uniquePorts,
            isUDPBlocked: false,
            hasIPv6,
            details: "Ambiguous results - unable to determine NAT type reliably"
        };
    }
}
