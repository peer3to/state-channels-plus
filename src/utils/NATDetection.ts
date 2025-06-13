export interface NATInfo {
    type: "cone" | "symmetric" | "blocked" | "unknown";
    externalIPs: string[];
    externalPorts: number[];
    isUDPBlocked: boolean;
    details: string; // Human readable explanation
}

export class NATDetectionService {
    private stunServers: string[] = [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
        "stun:stun3.l.google.com:19302"
    ];

    public async detectNATType(): Promise<NATInfo> {
        try {
            const results = await this.detectExternalNetworkAddress();
            return this.analyzeResults(results);
        } catch (error) {
            console.error("NAT detection failed:", error);
            return {
                type: "unknown",
                externalIPs: [],
                externalPorts: [],
                isUDPBlocked: true,
                details: `Detection failed: ${error}`
            };
        }
    }

    private async detectExternalNetworkAddress(): Promise<
        Array<{ ip: string; port: number; server: string }>
    > {
        const allResults: Array<{ ip: string; port: number; server: string }> =
            [];

        for (const stunServer of this.stunServers) {
            try {
                const result = await this.testSingleSTUNServer(stunServer);
                if (result) {
                    allResults.push({ ...result, server: stunServer });
                }
            } catch (error) {
                console.warn(`STUN server ${stunServer} failed:`, error);
            }
        }
        return allResults;
    }

    private async testSingleSTUNServer(
        stunServer: string
    ): Promise<{ ip: string; port: number } | null> {
        return new Promise((resolve) => {
            // Create a WebRTC peer connection configured to use only this STUN server
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: stunServer }]
            });
            let done = false;
            let result: { ip: string; port: number } | null = null;

            const cleanup = () => {
                pc.close();
            };

            // ANSWER COMES HERE: Listen for ICE candidates (potential network paths)
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    // We got a candidate! Check if it's the type we want
                    const c = event.candidate;

                    // 'srflx' = Server Reflexive = our external IP/port as seen by the STUN server
                    // This is what we're looking for - our public IP address!
                    // (Other types: 'host' = local IP, 'relay' = through TURN server)
                    if (c.type === "srflx" && c.address && c.port && !result) {
                        result = { ip: c.address, port: c.port };
                    }
                } else {
                    // event.candidate is null - this means ICE gathering is FINISHED
                    if (!done) {
                        done = true;
                        cleanup();
                        resolve(result);
                    }
                }
            };

            // TRIGGER HAPPENS HERE: Start the ICE gathering process
            pc.createDataChannel("singleTest");
            pc.createOffer()
                .then((offer) => pc.setLocalDescription(offer))
                .catch(() => {
                    // If creating the offer fails, we can't do STUN detection
                    if (!done) {
                        done = true;
                        cleanup();
                        resolve(null);
                    }
                });

            // Safety timeout
            setTimeout(() => {
                if (!done) {
                    done = true;
                    cleanup();
                    resolve(result); // Return whatever we found (or null)
                }
            }, 5000);
        });
    }

    private analyzeResults(
        results: Array<{ ip: string; port: number; server: string }>
    ): NATInfo {
        // No results = UDP blocked
        if (results.length === 0) {
            return {
                type: "blocked",
                externalIPs: [],
                externalPorts: [],
                isUDPBlocked: true,
                details:
                    "No server-reflexive candidates found - UDP likely blocked"
            };
        }

        const uniqueIPs = [...new Set(results.map((r) => r.ip))];
        const uniquePorts = [...new Set(results.map((r) => r.port))];

        // Same IP and same port from all servers = Cone NAT
        if (uniqueIPs.length === 1 && uniquePorts.length === 1) {
            return {
                type: "cone",
                externalIPs: uniqueIPs,
                externalPorts: uniquePorts,
                isUDPBlocked: false,
                details: `Consistent external endpoint ${uniqueIPs[0]}:${uniquePorts[0]} across all servers - cone NAT behavior`
            };
        }

        // Same IP but different ports = Symmetric NAT
        if (uniqueIPs.length === 1 && uniquePorts.length > 1) {
            return {
                type: "symmetric",
                externalIPs: uniqueIPs,
                externalPorts: uniquePorts,
                isUDPBlocked: false,
                details: `Same external IP ${uniqueIPs[0]} but different ports [${uniquePorts.join(", ")}] - symmetric NAT allocates ports per destination`
            };
        }

        // Multiple external IPs = Complex setup, assume symmetric for safety
        if (uniqueIPs.length > 1) {
            return {
                type: "symmetric",
                externalIPs: uniqueIPs,
                externalPorts: uniquePorts,
                isUDPBlocked: false,
                details: `Multiple external IPs detected [${uniqueIPs.join(", ")}] - complex network setup, treating as symmetric for safety`
            };
        }

        // Fallback case - shouldn't happen but handle gracefully
        return {
            type: "unknown",
            externalIPs: uniqueIPs,
            externalPorts: uniquePorts,
            isUDPBlocked: false,
            details: "Ambiguous results - unable to determine NAT type reliably"
        };
    }
}
