#!/usr/bin/env python3
"""Summarise a Pike play recording (pike-*.json from F9): frame rate, inputs used, steering, strikes and camera.
Run: python3 scripts/rec-summary.py ~/Downloads/pike-2026-11-19-19-01-50.json"""
import json
import math
import statistics
import sys
from collections import Counter


def angle_diff(a, b):
    return math.atan2(math.sin(a - b), math.cos(a - b))


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))] if xs else 0


def main(path):
    d = json.load(open(path))
    s = [x for x in d["samples"] if x.get("mode") == "playing"]
    ev = d["events"]
    m = d["meta"]
    print(f"# {path}")
    print(f"started {d['startedAt']}  screen {m.get('screen')}  pad {m.get('pad')}  touch {m.get('touch')}  quality {m.get('gfx', {}).get('quality')}")
    st = m.get("settings") or {}
    print(f"settings: map {st.get('map')} big {st.get('big')} growth x{st.get('growthMul', 1)} chill {st.get('chill')}  mouseSens {m.get('mouseSens')} invert {m.get('invertMouse')}")
    if not s:
        print("no playing samples")
        return
    dur = s[-1]["t"] - s[0]["t"]
    fps = [x["fps"] for x in s if x.get("fps")]
    print(f"\nplaying {dur:.0f} s, {len(s)} samples")
    print(f"fps: median {statistics.median(fps):.0f}, 5th pct {pct(fps, 0.05)}, min {min(fps)}")

    src = Counter()
    for x in s:
        if x["mouse"] != [0, 0]:
            src["mouse"] += 1
        if any(k in x["keys"] for k in ("KeyA", "KeyD", "ArrowLeft", "ArrowRight", "KeyS", "KeyF", "ArrowDown")):
            src["keys steer"] += 1
        if x.get("pad") and (abs(x["pad"]["turn"]) > 0 or abs(x["pad"]["pitch"]) > 0 or x["pad"]["th"] > 0):
            src["gamepad"] += 1
        if x.get("touch"):
            src["touch"] += 1
    print("steering input (share of samples): " + ", ".join(f"{k} {v / len(s):.0%}" for k, v in src.most_common()) or "none")

    err = [abs(angle_diff(x["wantYaw"], x["yaw"])) for x in s]
    print(f"heading error |want-yaw|: median {math.degrees(statistics.median(err)):.0f} deg, 95th pct {math.degrees(pct(err, 0.95)):.0f} deg")
    # sign flips of the turn command while turning hard: wobble / over-correction
    flips = sum(1 for a, b in zip(s, s[1:]) if a["in"]["yr"] * b["in"]["yr"] < -0.25)
    print(f"turn reversals (hard left<->right within 0.1 s): {flips} ({flips / max(dur, 1) * 60:.1f}/min)")
    rate = [abs(angle_diff(b["yaw"], a["yaw"])) / max(b["t"] - a["t"], 1e-3) for a, b in zip(s, s[1:])]
    print(f"body turn rate: median {math.degrees(statistics.median(rate)):.0f} deg/s, 95th pct {math.degrees(pct(rate, 0.95)):.0f} deg/s")
    bottom = sum(1 for x in s if x["pos"][1] - x["floor"] < 0.35)
    print(f"time hugging the bottom (<35 cm): {bottom / len(s):.0%}")
    swim = sum(1 for x in s if x["in"]["th"] > 0)
    print(f"swimming {swim / len(s):.0%} of the time, bursts in {sum(1 for x in s if x['burst']) / len(s):.0%} of samples")

    kinds = Counter(e["type"] for e in ev)
    strikes = kinds.get("sim-strike", 0)
    caps = [e for e in ev if e["type"] == "sim-capture"]
    misses = Counter(e.get("reason") for e in ev if e["type"] == "sim-miss")
    print(f"\nstrikes {strikes}: catches {len(caps)}, misses {sum(misses.values())} {dict(misses)}, empty {kinds.get('sim-strike-empty', 0)}")
    if strikes:
        print(f"hit rate {len(caps) / strikes:.0%}")
    locked = sum(1 for e in ev if e["type"] == "sim-strike" and e.get("lockId") is not None)
    print(f"strikes with a target locked: {locked}/{strikes}")
    print(f"camera switches {kinds.get('camera', 0)}: " + ", ".join(f"{c} {n / len(s):.0%}" for c, n in Counter(x["cam"]["mode"] for x in s).most_common()))
    print(f"pauses {kinds.get('pause', 0)}, errors {kinds.get('error', 0)}")
    for e in ev:
        if e["type"] == "error":
            print("  error:", e.get("message"), e.get("at", ""))
    g0, g1 = s[0]["lengthCm"], s[-1]["lengthCm"]
    print(f"grew {g0:.1f} -> {g1:.1f} cm")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        main(p)
