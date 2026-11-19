# Pike

You are a young northern pike in a small lake or a river. Hunt, grow from a 22 cm fry-hunter into a lake tyrant,
and get away when a bigger pike comes after you. Play alone or share a lake with up to 5 friends.

**Play:** https://panhusa.github.io/pike-sim/ (desktop or phone, nothing to install)

Everything you see is procedural: the lake, plants, light and every fish (anatomy, scales, patterns)
are generated in code. There are no image or model files.

## How to play
- **Chill** (default): nothing can kill you, just swim and hunt. **Challenge**: hunters, bites, anglers, starving.
- A minimap (N) shows food, bigger and smaller pike, players and the boat. **H** (or the ? button) lists every control.
- Pick the **water** when you start: the **lake** (still, reed beds, a deep middle) or the **river**
  (a current that carries you downstream, deep slow pools and wide fast riffles; fish hold against the flow).
- Pick the **growth** speed: Normal, Fast (x3) or Very fast (x8). When hosting, your choice applies to everyone.
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

**Desktop:** mouse steer · `A`/`D` (or arrows) turn · `S`/`F` dive/rise · `W` swim · `Shift`+`W` stalk · `Space`/click strike · `R` rest (still, in cover) ·
`C` camera · wheel zoom · `Q`/`E` orbit · `V` reset view · `M` sound · `Esc` menu. "Invert mouse" (start screen or menu) makes pushing the mouse forward dive;
"Mouse sensitivity" sets how far the pike turns per mouse movement. A strike aims at the fish for a split second, then shoots straight.

**No mouse:** the keyboard alone works (`A`/`D` turn, `S`/`F` dive/rise, `W` swim, `Space` strike, `Enter` on a menu),
and so does a gamepad: left stick steer, RT swim, LT stalk, A/RB strike, B rest, Y camera, right stick orbit,
Start pause, Back minimap, A on a menu to resume/continue/start.

**Phone:** joystick to steer and swim (push further to go faster) · Strike · Rest · Cam · Pause.
Tilt steering can be chosen on the start screen.

## Multiplayer
One player picks lake or river, clicks **Host** and reads out the 5-letter code; friends enter it and click **Join**.
Browsers connect directly (WebRTC); the public [PeerJS](https://peerjs.com) broker only introduces them,
and no game data goes through any server. The host's browser runs the lake, so keep that tab open.
Strict corporate or some mobile networks can block direct connections.

## Graphics
Everything you see is procedural: fish bodies, scales, plants, lakebed, sky and sounds are generated in code, with no
downloaded models or textures.

- **Style:** Realistic (murky sunlit water, caustics, Snell's window, light shafts) or Stylised (flat depth bands,
  toon lighting, outlined fish and logs, a more saturated palette). Pick it on the start screen or in the pause menu;
  it applies at once.
- **Quality:** High adds bloom, light shafts, the colour-grade pass, 4x MSAA, denser plants and more particles. Low
  draws straight to the screen at pixel ratio 1. Touch devices start on Low. On High, if the first 3 s of play
  average under 40 fps and you never picked a quality, the game drops to Low by itself. Resolution also drops step by
  step on devices that stay slow.
- **Debug HUD:** add `?debug=1` to the URL to see fps, draw calls and the current quality next to the clock
  (and press `T` to fast-forward time).

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

## License
MIT, see [LICENSE](LICENSE). All art (models, textures, sounds) is procedural and covered by the same licence.
