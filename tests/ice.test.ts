import { describe, expect, it } from "vitest";
import { peerConfig } from "../src/net/ice";

describe("WebRTC ICE config", () => {
  it("has a STUN server and a TURN relay over UDP, TCP and TLS 443", () => {
    const urls = peerConfig(false).iceServers.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
    expect(urls.some((u) => u.startsWith("stun:"))).toBe(true);
    expect(urls).toContain("turn:global.relay.metered.ca:80");
    expect(urls).toContain("turn:global.relay.metered.ca:80?transport=tcp");
    expect(urls).toContain("turns:global.relay.metered.ca:443?transport=tcp");
    for (const s of peerConfig(false).iceServers) if (String(s.urls).startsWith("turn")) expect(s.username && s.credential).toBeTruthy();
  });
  it("uses every route by default and only the relay when forced", () => {
    expect(peerConfig(false).iceTransportPolicy).toBe("all");
    expect(peerConfig(true).iceTransportPolicy).toBe("relay");
  });
});
