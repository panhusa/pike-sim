# Pike

You are a northern pike in a lake or a river. Hatch in the weeds, hunt, grow from a 1.2 cm larva into a legend,
and get away when a bigger pike comes after you. Play alone or share a lake with up to 5 friends.

**Play:** https://panhusa.github.io/pike-sim/ (desktop or phone, nothing to install)

Everything you see is procedural: the lake, plants, light and every fish (anatomy, scales, patterns)
are generated in code. There are no image or model files.

## How to play
- **Chill** (default): nothing can kill you, just swim and hunt. Hunters and other threats still come after you;
  if one gets you, you are **chased off** (stopped dead, combo lost) instead of hurt.
  **Challenge**: bites cost hearts, and hunters, herons, otters, anglers and starving can end your life.
- A minimap (N) shows food, bigger and smaller pike, players and the boat. **H** (or the ? button) lists every control.
- Pick the **water** when you start: the **lake** (still, reed beds, a deep middle) or the **river**
  (a current that carries you downstream, deep slow pools and wide fast riffles; fish hold against the flow).
- Each water has **three save slots**. The start screen lists your saved lives (continue or delete);
  pick a slot for a new life and it asks before replacing a saved one.
- **Start as** a larva (default) or a later stage: young pike (22 cm), Jack (30 cm), Hunter (40 cm),
  Predator (55 cm) or almost a Lake tyrant (74 cm).
- **The larva:** you hatch at 1.2 cm as an egg cluster bursts open in the weeds, and you can steer at once.
  You carry a yolk sac until 2.5 cm. Until 22 cm every catch grows you straight away, and schools of baby fish your
  size stay close by, so the first stages fly past (about 3 to 5 minutes to 22 cm at Normal, in the lake or the river).
- Grow through Larva, Fry, Fingerling, Juvenile, Fry-hunter, Jack, Hunter, Predator, Lake tyrant and Legend.
- Pick the **growth** speed: Normal, Fast (x3) or Very fast (x8). When hosting, your choices apply to everyone.
- Fish near you get a ring. **Green** = in reach, strike now. **Amber** = edible, get closer. **Grey** = too big.
- Quick catches build a combo (up to x5). Goals at the top pay bonuses; growing unlocks new stages.
- **Trials:** reaching a new stage (Fry to Lake tyrant) starts that stage's trial, worth a big bonus:
  3 catches inside 10 s, an ambush from the weeds, a perch, an insect snapped in mid-air, surviving a hunting pike,
  5 catches in a row without a miss, throwing the angler's hook, and the tyrant.
- **The Old Tyrant:** when you grow into a Lake tyrant (75 cm), the pike that rules the water comes for you.
  It is a quarter longer than you, circles and charges every few seconds. Bite it 3 times (a separate strike each
  time) to drive it off; dodge its charges. It swims away after 2 minutes if you can't, and comes back a minute later.
- At every size, now and then a pike big enough to eat you hunts you: outswim it, or hide still in the weeds.
  A bite costs one of your three hearts; hearts come back over time.
- **Herons** (4 to 60 cm, in water under 1.2 m deep): a shadow passes overhead, then the beak stabs where you were a
  moment ago. Keep moving. **Otters** (10 to 70 cm) come in from the shore and chase you: hide still in the weeds or
  outswim them. Only one threat comes at a time.
- **Frogs** sit on the surface in the shallows and dive when you come close; from 14 cm you can swallow one
  from below. Schools of **bream** (20 to 45 cm, open water) and
  lone **tench** (15 to 40 cm, weedy shallows) are big meals for a grown pike.
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
and so does a gamepad (PlayStation names, Xbox in brackets): left stick steer, R2 (RT) swim, L2 (LT) stalk,
✕ or R1 (A / RB) strike, ○ (B) rest, △ (Y) camera, right stick orbit, Options pause, Share minimap,
✕ on a menu to resume/continue/start. **Controller setup** (start screen or menu) re-binds any action, for
any controller.

**Phone:** joystick to steer and swim (push further to go faster) · Strike · Rest · Cam · Pause.
Tilt steering can be chosen on the start screen.

**Recording:** `F9` starts recording (or open the game with `?rec=1`): the 3D view as a `.webm` video and a `.json`
log of inputs, the pike's movement, camera, frame rate and catches/strikes. `F9` again saves both to Downloads.
Nothing is uploaded.

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
- **Start-up:** "Filling the lake…" builds the scene and compiles its shaders before play starts, so the first
  seconds of a life do not stutter. Plants and other repeated objects too far away to see through the water are
  not drawn.
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
