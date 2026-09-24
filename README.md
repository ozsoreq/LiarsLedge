# Liar's Ledge

A browser climbing game in the spirit of *Getting Over It*: you drag each hand up a sheer 600 m wall with the mouse, one fall can cost you everything, and the wall lies to you.

> QWOP-style two-hand bouldering meets a mountain that gaslights you. You learn the controls in ten minutes, then spend hours learning not to trust what you see.

## Play

No build step and no dependencies. Open `index.html` in a desktop browser (Chrome, Edge, Firefox or Safari), or serve the folder:

```sh
npx serve .        # or: python3 -m http.server
```

A mouse with two buttons is required. Headphones help: every trick has a sound.

| Input | Result |
| --- | --- |
| Hold **left button** + move | Left hand reaches toward the cursor, within arm's length |
| Release **left button** | Left hand grips whatever is under it, if anything |
| Hold / release **right button** | The same for the right hand |
| **Both buttons** held | Both hands let go: a deliberate dyno (jump). Pull up first and you go further. |
| **Mouse wheel** (or **W** / **S**) | Pull up / lower the body on the gripping arm(s) |
| **Esc** / **P** | Pause (sound, mouse sensitivity, level editor, start over) |
| **M** | Mute |

Progress (your exact body pose, grips, stamina, best height, time, falls and what the Guide has already said) is saved in the browser every few seconds, so closing the tab doesn't reset you. There are no checkpoints.

## How the design is built

### Honest physics

`src/physics.js` is a 13-point Verlet ragdoll. Arms are ropes from shoulder to hand (max length only; elbows are drawn with IK), legs are dead weight. A grip pins the hand to the hold. The design doc suggested Matter.js; a small custom solver turned out to be a better fit. It keeps the game dependency-free, makes arm length (the pull-up) a single number, and runs headless in Node, which is how the tests drive a scripted climber up the wall.

- **Reach:** 1.1 m from the shoulder. Holding the cursor further out drags the body toward it while you hang (the swing), and drains the gripping arm.
- **Grip:** only on holds. Bigger holds drain stamina slower. Catching yourself mid-fall costs stamina by speed; too fast and the hand rips off.
- **Stamina:** one bar per arm. Hanging on one arm drains it, two arms drain slowly, a free arm recovers, and resting on a ledge refills both. At zero the hand opens.
- **Core:** while holding on, the torso tends to stay upright (the climber's muscles). Lying on a ledge, reaching past your arm lets you shuffle along it.
- **Falling:** you fall until a hand, a ledge or a net catches you. No death, no reset, only lost height.

### The deception system

The game lies through the **wall**, the **interface** and the **narrator**, never through the body. Each trick has a tell, is first shown just above a safe ledge, and later comes back combined with others.

| Trick | Where | The tell (implemented) |
| --- | --- | --- |
| Fake hold: crumbles 0.5 s after you grab it | Zone 2+ (first at ~82 m, 1 m above a wide ledge) | Six sharp corners instead of a rounded blob, and no ambient shadow |
| Shy hold: slides away when the cursor gets close | Zone 2+ (first at ~95 m) | Trembles when the cursor passes nearby. Grab it within 0.2 s and it's tamed for good |
| Painted wall: a backdrop, hands pass through and tear it (scaffolding behind) | Zone 3+ (first at ~205 m, next to a rest ledge) | Drawn at a slightly different depth, so it drifts a few pixels against the real rock when you swing |
| Fake fall: shake, blur, whoosh, the Guide panics | Zone 3+ (first at ~212 m) | The grip hum keeps playing: audio follows real grips only |
| Swapped hands | Zone 4-5 bands (first at 336 m above a ledge) | A soft chime and a glint running over both gloves |
| Mirrored cursor | Zone 4-5 bands | The cursor trail is built from raw mouse motion, so it tilts the wrong way |
| Lying stamina bar: shows full while the arm is tired | Zone 4-5 bands | Tired hands tremble and the grip hum thins out, whatever the bar says |
| Altimeter lies (500 m at 400 m; lower near the top) | Zone 4-5 bands | The painted height markers on the wall are always true |
| Helpful arrow: suggests a route into a trap | Zones 2-5 | Arrows only exist while the Guide is speaking |
| Fake summit: credits roll, music swells, then the floor gives way (30 m) | 560 m | The credits list people who don't exist. The "sky" above the ledge is a painted backdrop that falls away |
| The tell lies, once | ~583 m | A hold with the fake-hold tell that is real and the only way up, signposted by the Guide's glee |

### World

One continuous wall (`src/level.js`), generated deterministically so everyone climbs the same lie. A guaranteed route of real holds is placed so that every step is reachable from the locked-off shoulder of the hand taking it. Rest ledges, alternative holds and the lies are built around it.

| Zone | Height | New lie |
| --- | --- | --- |
| 1. The Quarry | 0-80 m | None (a pure tutorial, with one taught dyno over a ledge) |
| 2. The Gallery | 80-200 m | Fake and shy holds |
| 3. The Stage | 200-330 m | Painted walls, fake falls, stunt nets |
| 4. The Glitch | 330-480 m | UI lies: swapped hands, mirrored cursor, lying bars, lying altimeter |
| 5. The Summit | 480-600 m | Everything, the fake summit and the one lying tell |

The real summit is quiet. The Guide stops talking for good, the music fades, and after a while your time and fall count appear.

### The Guide

`src/narrator.js` speaks in subtitles in a calm, meditation-app voice. His tips in the Quarry are true. From the Gallery on, about one in three is false (each line is marked `lie: true` in the script). He is never wrong about physics, comforts you after falls with numbers that aren't quite right, confesses in Zone 5, and then lies about which lies were lies.

### Look & sound

Canvas 2D with a flat, calm palette: faceted rock with soft gradients, rounded glowing holds, and a faceless climber with a warm left glove and a cool right one. Each zone has its own palette and dressing (white gallery panels, stage scaffolding and lights, pixel glitches and scanlines, warm summit light), over a parallax city, then clouds, then sky. All sound is synthesized with WebAudio: a lo-fi pad that thins out with height, crisp grip clicks, a fall whoosh and thud, a signature sound per trick, and the honest grip hum.

## Level editor

Press **F2** (or use the pause menu). You can place normal, fake, shy, painted and tell-lie holds, drag ledges, nets and painted panels, delete things, scroll the wall, **Play from here**, and **Export / Import JSON**. Edits are saved in the browser and loaded on start. Add `?generated` to the URL to ignore them. Outlines in the editor show the truth about every hold.

## Development

```sh
npm test            # level invariants, physics, tricks, save/load, a scripted climb 0 → 80 m
npm run test:long   # also climbs sections of every zone
```

URL flags for development: `?debug` (outlines tricks; PageUp / PageDown teleport ±20 m, G toggles infinite stamina), `?at=345` (start at a height), `?play` (skip the title screen), `` ` `` toggles the debug outlines.

```
index.html, style.css   page shell and menus
src/util.js, config.js  helpers and every tunable (reach, stamina, zones…)
src/physics.js          Verlet ragdoll
src/level.js            wall generator, set pieces, JSON format
src/sim.js              hands, grips, stamina, tricks, falls, summits (DOM-free)
src/narrator.js         the Guide
src/audio.js            WebAudio synthesis
src/render.js           Canvas renderer and HUD
src/editor.js           level editor
src/main.js             input, loop, menus, saving
tools/harness.js        loads the sim into Node + a scripted climber
tools/test.js           tests
```

## Open questions from the design doc, as built

- **Feet?** The body is dead weight. It's funnier, and it keeps every move in the hands. Ledges still catch feet, and a supported body recovers stamina.
- **Fake summit vs. streamers:** its tell (credits for people who don't exist) and the painted sky still work as a skill check once you know it's coming.
- **Mobile:** not yet. Everything reads input through one small layer in `main.js`, so two-finger touch could map onto the two buttons later.
- **Voice:** the Guide is text-only for now. Lines are data in `narrator.js`, ready to be voiced.
