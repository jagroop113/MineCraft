# MineCraft (Three.js creative sandbox)

A browser sandbox: explore an endless, seed-generated world of biomes,
mountains, rivers, waterfalls and cherry blossom groves, meet its wildlife
through day, night and changing weather, and build with 35 block types, on
desktop or on a phone.

## Running

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # production build in dist/
npm run preview    # serve the production build locally
```

Add `?debug` to the URL for developer tools: the terrain GUI (lil-gui), FPS
stats, collision helpers, the position readout, a free orbit camera in the
pause menu, and `window.__game` / `__physics` / `__player` in the console.

## Controls

| Action | Desktop | Touch |
|---|---|---|
| Move | W A S D | Left joystick (hops up 1-block steps) |
| Look | Mouse | Drag on the right half |
| Jump / sprint | Space / hold Shift | Jump / Run buttons |
| Place / remove block | Left / right click (hold to repeat) | Place / Break buttons (hold to repeat) |
| Pick targeted block | Middle click | – |
| Select block | 1–9 or mouse wheel | Tap (scroll) the hotbar |
| Inventory | E | ▦ button |
| Pause / settings | Esc | ❚❚ / ⚙ buttons |
| Build / explore mode | B | – |
| Undo / redo | Ctrl+Z / Ctrl+Y | – |
| Save now | Ctrl+S | Pause menu |
| Fullscreen | F | ⛶ button (where supported) |
| Back to spawn | R | – |
| Show / hide controls | H | – |

Touch controls switch on automatically on phones and tablets (and on any
device after the first touch).

## Worlds

- **Natural** (default for new worlds): endless terrain in 32×64×32 chunks
  (16 / 64 selectable), streamed around the player and generated in Web
  Workers. Biomes come from temperature and moisture: plains, wildflower
  meadows, oak / birch / pine / snowy / tropical forests, cherry blossom
  groves, deserts and mountains. Rivers and streams follow the terrain down
  to lakes; waterfalls form on stream steps and cliff springs; caves run
  underground.
- **Classic**: the original heightmap generator (now also endless). Worlds
  saved before the natural generator existed load as Classic, unchanged.

Every world has a seed (random, or typed when creating it); the same seed
always produces the same terrain.

## Settings

Graphics presets (Auto picks Low on touch devices, Medium on integrated GPUs,
High otherwise):

| | Low | Medium | High |
|---|---|---|---|
| Render distance | 64 blocks | 96 | 128 |
| Shadows | off | 1024², hard, every 3rd frame | 2048², soft, every 2nd frame |
| Grass density / distance | 35% / 32 | 50% / 40 | 100% / 80 |
| Animals | 10 | 22 | 36 |
| Particles | 35% | 70% | 100% |
| Water highlights | – | – | ✓ |

Adaptive resolution (on by default) lowers the render resolution while the
frame rate is low and raises it again when there is headroom. Other settings:
day length (or paused time), sound and ambient volume, mouse sensitivity,
field of view, building range, undo history, autosave interval.

## Configuration

| Variable | Purpose |
|---|---|
| `VITE_MULTIPLAYER_URL` | WebSocket URL of the multiplayer server (`server/`). Unset = single-player. |

Copy `.env.example` to `.env` (development) or `.env.production` (builds).
Vite inlines the value at build time, so rebuild after changing it.

## Saving

- Worlds are stored in the browser's **IndexedDB** (`minecraft-js` database):
  world type, seed, biome scale and terrain settings, chunk size, player
  position/orientation, time of day, weather and every block change (only
  changes are stored; terrain is regenerated from the seed). Each save keeps
  the previous one as a backup, restored automatically if the latest save is
  damaged.
- Settings and the hotbar are stored in **localStorage** (`minecraft-js:settings`).
- The game autosaves (configurable), when pausing and when the tab is hidden.
- Saves use a versioned schema (`scripts/building/saveFormat.js`, now v3);
  v1 and v2 saves are migrated on load.

## Deploying

`npm run build` produces a static site in `dist/` (including the terrain
worker) that any static host can serve. Textures are loaded relative to
Vite's `base`, so deploying under a sub-path works once `base` is set in
`vite.config.js`. Serve over HTTPS where possible (secure context; some
mobile browsers require it for fullscreen).

## Project layout

```
scripts/
  main.js              scene, renderer, camera, lights, game loop
  world.js             endless chunk streaming, worker pool, block edits
  worldChunk.js        chunk data (Uint8Array) and atlas / face-instanced rendering
  blocks.js            block registry, texture atlas, lookup tables
  proceduralTextures.js  painted textures for blocks without image files
  terrain/             generators (natural, classic), biomes, hashing, worker
  environment/         day/night, sky, weather, particles, ambient sound
  wildlife/            species models and behaviour, animal manager
  mobile/              touch controls
  player.js, physics.js, Npc/   existing movement, collision and NPCs
  multiplayer.js       optional WebSocket multiplayer
  building/
    game.js            composition root and game state (menus, pause, play)
    graphics.js        presets and adaptive resolution
    buildingSystem.js  placement / destruction rules and undo history
    blockTargeting.js, voxelRaycast.js   crosshair raycast, highlight, preview
    inputController.js keyboard / mouse / focus handling
    inventory.js, history.js, settings.js
    worldManager.js    create / load / save / reset / delete / autosave
    worldPersistence.js, saveFormat.js   IndexedDB storage and save schema
    particles.js, sounds.js, performanceMonitor.js
    ui/                HUD, menus and block icons
tests/                 Vitest unit tests
```
