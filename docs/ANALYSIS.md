# Analysis of the extracted assets

What this archive contains, what can be rebuilt from it, and what is missing to bring back the original game.

It is the groundwork for the playable prototype in [`revival/`](../revival/README.md).

## At a glance

| | Available | Missing |
|---|---|---|
| **World** | Full Suburbs geometry, **already in world space**. 3 interiors. | Unity scenes: placement of NPCs, interactive objects and portals. |
| **Characters** | 110 NPCs, 109 of them textured (`npc_*` + `npc_custom_*_col`). | Skeletons and animations: the `.obj` files are static. The player character is modular (head, body, clothes), but only the icons of those parts survive. |
| **Gameplay** | NPC, quest (124 names), combat and collectable definitions in `world_objects`. | Client code (`Assembly-CSharp.dll`) and server code, so the quest, combat and progression logic. |
| **Sound** | 1,024 unique sounds: music, ambience, effects, a few dialogue lines. | The table mapping logical names (`suburbsOverworld1`) to files (`aud_music_loop_spoonerStreet1`). I rebuilt it by hand for the prototype. |
| **Rendering** | Decompiled shaders (`FG Flat`, `FG Flat (with detail)`, `Shader Outline`…). | The second UV set (UV1) of the "detail" meshes: the OBJ export only carries UV0. |

## Contents by folder

| Folder | Files | Contents |
|---|---|---|
| `Mesh/` | 3,134 `.obj` (1,435 unique names) | Map tiles, props, NPCs, weapons. Files named `name #1234.obj` are re-exports of the same name from other bundles. **They are not always identical**: `D3_signs #197162` is placed in the world, while `D3_signs` sits at the origin. |
| `Texture2D/` | 3,149 `.png` (1,482 unique) | Colour palettes, detail textures (`*_dtl`), NPC textures, UI and inventory icons (`*_ico`). |
| `AudioClip/` | 2,968 `.ogg` (1,024 unique) | `aud_sfx_*` (838), `aud_gui_*` (118), `aud_ambient_*`, `aud_music_*` (24), `aud_dialog_*`. |
| `Shader/` | 2,318 | Decompiled ShaderLab sources, useful to understand the original rendering. |
| `MonoBehaviour/` | 920 `.json` | Serialized component values, mostly visual effects (`EffectSequencer`, `GenericEffectPlayer`, `PrefabSpawner`). No positions. |
| `TextAsset/` | 53 | Gameplay data in XML, detailed below. |

## The Suburbs map

`world_objects` declares the grid: `world="Suburbs" gridsize="130" numxgrids="5" numzgrids="5"`.

The meshes follow that layout exactly. Their prefix gives their cell (`B2_`, `C3_`…), and their vertices are **already in world space**:

```
        x →   +260   +130     0    -130   -260
              A      B       C      D      E
  z  -260     ·      ·       C1     D1     ·
  ↓  -130     ·      B2      C2     D2     E2
        0     ·      B3      C3     D3     E3     (C3 centred on the origin)
     +130     ·      B4      C4     D4     E4
     +260     ·      B5      C5     D5     E5
```

So the whole town can be rebuilt by loading every tile, with no scene data at all. Each cell holds sub-meshes whose type shows in their name:

- `collisionGround_{grass,cement,dirt,water}`: walkable ground. Hidden in game, since visible surfaces duplicate it.
- `collision_geo`, `collisionInvisible_geo`: collision hulls for walls.
- `colourPalette*`, `detail*`: buildings and props, painted through a colour palette.
- `shadow*`: semi-transparent ground shadows.
- `tree*`, `bush*`, `window*`, `chainlink`…: alpha-cutout textures.
- `backdrop_*`: distant scenery (skyline, clouds, hills).

A few props were exported in local space: their transform lived in the lost scene, so they pile up at the origin. Examples are `B2_delorian_geo` and `D3_shadowCircle_geo1/2`. The manifest builder detects them and picks the correctly placed `#id` variant when one exists.

### Interiors

| Prefix | Contents |
|---|---|
| `Z1_` | **The Griffin house.** Chris's, Meg's and Stewie's rooms, kitchen and living room, portraits. `griffinHouse*_col` textures. |
| `Z9_` | Another house: living room, bedrooms, stairs. |
| `A1_` | A two-storey interior. |

These interiors are exported at the origin and are not linked to the town: there are no door or portal positions.

## How the game drew the town

All town rendering goes through the `FG Flat` shaders: unlit, with the lighting painted into the textures.

- **`FG Flat`**: `texture × colour`. Reproduced with a `MeshBasicMaterial`.
- **`FG Flat (with detail)`**: the base colour comes from `colourPalette_col` through **UV0**, and the `*_dtl` texture (siding stripes, roof tiles, grass) is blended on top through **UV1**, by its alpha. `Cull Off` makes it double-sided. Since the OBJ export only has UV0, the prototype shows the palette without the detail pattern.
- **Two palettes**: `colourPaletteSuburbs_col` is used for props, cars, fences and barriers. `colourPalette_col` is used for house walls and roofs; it has "House Side / House Roof / House Misc" sections.
- **`Shader Outline`**: the cartoon outline is computed on the fly, by extruding along normals with `Cull Front`, and only on characters. The town's `colourPaletteOutline*` meshes **are not** outlines: they are ordinary coloured props.

## Gameplay data (`TextAsset/`)

| File | Contents | Usable? |
|---|---|---|
| `world_objects` | About 200 archetypes for Suburbs: quest givers (Peter, Stewie, Lois, Brian, Chris, Quagmire, Dr Hartman, Peterdactyl…), enemies (`OCM_BaseBallEnemy`, `Cosby Combatant`…), collectables, Multiverse portals. Each defines its models, quests, skills, sounds, and the actions of its interaction (`SetModel`, `PlayAnim`, `PlayExclusiveCharacterSound`…). | **Yes**, to recreate NPCs and quests. **But there are no positions**: the server placed the objects. |
| `world_objects #198419` | Kyle's House, a combat area with a `MediumEnemy` (hit points, aggro range, skills). | Yes, as an enemy template. |
| `animtrees` (×4) | 49 animation trees (dad, mom, kid, dog, NPCs…) referencing 626 `.fbx` clips. | No: the animation clips are not in the archive. |
| `World_Audio` | Music per area (`bgmusic`, `combatmusic`, interiors…) and positional sounds. | Yes, but with logical names. |
| `camerainstructions` | A single camera position: `(98.2, 3.7, 10.6)`, in B3. | Barely. |
| `vanillaspawnpoints` | Empty (`<vanillaspawnpoints />`). | No. |
| `asset_list` (×34) | Lists of asset names per bundle. | Useful to see which assets belonged together. |

## What it would take to go further

1. **Placing NPCs.** `world_objects` says *who* exists, not *where*. Positions would have to come from screenshots or videos of the original game, or from a client dump that still has its scenes (`.unity3d`). Otherwise they are placed by hand.
2. **Animations.** Without skeletons or clips, characters stay rigid. Options are a hand-made rig (in Blender, for instance) or a re-export from a more complete Unity cache.
3. **The detail pattern (UV1).** It can be recovered by re-extracting the meshes in a format that keeps UV1 (glTF, FBX), or approximated with a projection.
4. **Game logic.** Everything has to be rewritten: quests, combat, progression. The `world_objects` definitions are a good starting spec.

## Tools

- [`revival/tools/build-manifest.mjs`](../revival/tools/build-manifest.mjs) applies all the rules above: mesh → texture matching, typing, detection of unplaced props, and the NPC and archetype lists. It writes `revival/public/manifest.json`.
