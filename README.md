# Pike

You are a young northern pike in a small lake. Hunt, grow from a 22 cm fry-hunter into a lake tyrant,
and get away when a bigger pike comes after you. Play alone or share a lake with up to 5 friends.

**Play:** https://panhusa.github.io/pike-sim/ (desktop or phone, nothing to install)

Everything you see is procedural: the lake, plants, light and every fish (anatomy, scales, patterns)
are generated in code. There are no image or model files.

## How to play
- Fish near you get a ring. **Green** = in reach, strike now. **Amber** = edible, get closer. **Grey** = too big.
- Quick catches build a combo (up to x5). Goals at the top pay bonuses; growing unlocks new stages.
- Every few minutes a pike big enough to eat you hunts you: outswim it, or hide still in the weeds.
  A bite costs one of your three hearts; hearts come back over time.
- Insects fall onto the surface: strike them from just below for a snack. Mayflies dance above the water.
- Swim up fast and Strike near the surface to **leap** out of the water: you get a look at the shore,
  the forest and the sky, and can snap mayflies in mid-air.
- Now and then a boat drifts over and an angler casts a lure. It looks like a fish, but a strike gets you
  **hooked**: mash Strike and swim away from the boat to throw the hook. If you get landed, the angler lets
  you go only if you have hearts to spare.

**Desktop:** mouse steer · `W` swim · `Shift`+`W` stalk · `Space`/click strike · `R` rest (still, in cover) ·
`C` camera · wheel zoom · `Q`/`E` orbit · `V` reset view · `M` sound · `Esc` menu. "Invert mouse" (start screen or menu) makes pushing the mouse forward dive.

**Phone:** joystick to steer and swim (push further to go faster) · Strike · Rest · Cam · Pause.
Tilt steering can be chosen on the start screen.

## Multiplayer
One player clicks **Host a lake** and reads out the 5-letter code; friends enter it and click **Join**.
Browsers connect directly (WebRTC); the public [PeerJS](https://peerjs.com) broker only introduces them,
and no game data goes through any server. The host's browser runs the lake, so keep that tab open.
Strict corporate or some mobile networks can block direct connections.

## Development
TypeScript + Three.js + Vite. The simulation (`src/sim`) is headless and separate from rendering
(`src/render`); tunable numbers live in `src/data/params.json`; multiplayer is in `src/net`.

```
npm install
npm run dev      # play locally
npm test         # vitest (the calibration tests take a few minutes)
npm run build
```

Biology runs on a calendar clock (1 game day = 600 s) while swimming is real-time; calibration tests pin
growth to published pike ranges. The game layer gives the player arcade tuning (`params.arcade`);
rivals and the calibration keep the realistic model.
