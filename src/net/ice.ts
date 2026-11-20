/**
 * WebRTC routes for multiplayer. Browsers first try to connect directly (STUN finds each side's public
 * address); when a router or mobile network blocks that, traffic goes through the TURN relay.
 * PeerJS's own free relays (eu-0/us-0.turn.peerjs.com) no longer exist, so the game brings its own:
 * a metered.ca free-tier relay. These credentials are public by design (they ship in every page);
 * the worst misuse is someone spending the free monthly quota.
 */
const TURN_USER = "53489e1b7a0d25f74d32c846";
const TURN_PASS = "mWB94TGuT/mLPymV";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.relay.metered.ca:80" },
  { urls: "turn:global.relay.metered.ca:80", username: TURN_USER, credential: TURN_PASS },
  { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: TURN_USER, credential: TURN_PASS },
  { urls: "turn:global.relay.metered.ca:443", username: TURN_USER, credential: TURN_PASS },
  { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: TURN_USER, credential: TURN_PASS },
];

/** RTCPeerConnection config for PeerJS. `relayOnly` forces the relay (testing: open the game with ?relay=1). */
export function peerConfig(relayOnly: boolean): { iceServers: RTCIceServer[]; iceTransportPolicy: RTCIceTransportPolicy } {
  return { iceServers: ICE_SERVERS, iceTransportPolicy: relayOnly ? "relay" : "all" };
}

/** True when the page was opened with ?relay=1. */
export function relayOnlyFromUrl(): boolean {
  try {
    return new URLSearchParams(location.search).get("relay") === "1";
  } catch {
    return false;
  }
}
