# Family Guy Online — Revival (prototype)

A playable prototype rebuilt from the archive's original assets. You can walk around Quahog (Spooner Street and its surroundings) and three interiors, including the Griffin house, as any of 110 NPCs. **Co-op over the local network** supports up to 16 players.

The game runs in the browser, like the original, which used the Unity Web Player. The launcher starts the server and opens the game.

## Running the game

You need [Node.js](https://nodejs.org) 20 or newer.

| System | Command |
|---|---|
| Linux / macOS | `./launch.sh` at the repository root |
| Windows | double-click `launch.bat` |
| Anywhere | `cd revival && npm install && npm start` |

On first run, the launcher installs the dependencies and builds the asset manifest (a few seconds). It then starts the server on port **8642** and opens the browser.

### Playing with friends

1. The host starts the game as usual. The terminal shows their local network address, for example `http://192.168.1.20:8642`.
2. Friends open that address in their browser, or run `./launch.sh --join 192.168.1.20`.
3. Players who picked the same area see each other, move around together and can chat.

To play outside the local network, forward port 8642 on the host's router, or use a VPN such as Tailscale, ZeroTier or Hamachi.

### Launcher options

```
npm start -- --port 9000     # use another port
npm start -- --no-browser    # dedicated server, no browser
npm start -- --join <ip>     # join a friend's game
npm start -- --rebuild       # rebuild the asset manifest
```

With `launch.sh` or `launch.bat`, pass the same options without the `--`: `./launch.sh --port 9000`.

## Controls

| Key | Action |
|---|---|
| WASD / arrows | Move (physical keys, so ZQSD works on AZERTY keyboards) |
| Shift | Run |
| Space | Jump |
| Click, then mouse | Rotate the camera (Esc releases the mouse) |
| Mouse wheel | Zoom |
| Enter | Chat |
| 1 to 4 | Sound emotes (Giggity!, Peter…) |
| M | Toggle music |
| Esc | Menu: change character or area |

## Architecture

```
revival/
├── launcher.mjs              manifest + server + opens the browser
├── server.mjs                HTTP (client + assets) and co-op WebSocket relay (/ws)
├── tools/build-manifest.mjs  scans Mesh/ Texture2D/ AudioClip/ TextAsset/ → public/manifest.json
└── public/
    ├── index.html, style.css   menu and HUD
    └── game.js                 engine (Three.js): map loading, physics, camera, networking
```

- **Assets are neither copied nor converted.** The server serves the repository's `Mesh/`, `Texture2D/`, `AudioClip/` and `TextAsset/` folders directly.
- **The manifest** describes each map as a list of meshes, each with its texture and type: ground, collision, solid, cutout, shadow… All the matching rules are explained in [`docs/ANALYSIS.md`](../docs/ANALYSIS.md).
- **Physics** relies on downward rays against the `collisionGround` surfaces, and horizontal rays against the `collision_geo` hulls, which lets the player slide along walls.
- **Networking** is a plain state relay: each client sends its position about 15 times per second, and the server forwards it to the players in the same area, along with chat and emotes. There is no server authority; that is enough for co-op between friends.

From the browser console, `fgo.player.pos` shows the current position, which helps when placing things. `fgo.world` and `fgo.scene` are available too.

## Known limitations

They come from what the archive does not contain. See [`docs/ANALYSIS.md`](../docs/ANALYSIS.md).

- **Characters are not animated.** The meshes have no skeleton; walking is faked with a sway.
- **No NPCs in the world, no quests, no combat.** Their definitions exist in `world_objects`, but not their positions, and the original game code is missing.
- **No detail patterns** (siding stripes, roof tiles): the OBJ export lost the second UV set. Houses keep their real colours, but their surfaces are flat.
- **A few props are mistextured** in the interiors. For example, `Z1_props_geo` combines several materials whose textures are unknown.
- **Interiors are separate areas**, picked from the menu: you cannot enter through doors.

## Next steps

1. Place NPCs and quest givers by hand, using `fgo.player.pos` to read coordinates, based on videos of the original game.
2. Implement simple quests from `world_objects`: collecting pages or items, talking to an NPC.
3. Add doors linking the town to the interiors.
4. Rig a few characters (Peter, Stewie, Brian) to get real animations.
