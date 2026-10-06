# Source and Source 2

## Source 1 (Half-Life 2, Portal 2, TF2, L4D2, Garry's Mod, CS:S)

Identify: the game has `<mod>/gameinfo.txt`, `*_dir.vpk`, and `bin/engine.dll`.

- Content without code:
  - `custom/` or `addons/` folders take loose files or VPKs that override by path.
  - Maps use Hammer (`.vmf`, then vbsp, vvis, and vrad, then `.bsp`).
  - Models use Crowbar (decompile and compile `.mdl` with `.qc`).
  - Materials (`.vmt` and `.vtf`) use VTFEdit.
- Scripting:
  - VScript (Squirrel) in Portal 2, L4D2, TF2, and CS:GO-era games: `scripts/vscripts/*.nut` and entity I/O.
  - Garry's Mod: Lua addons (`lua/autorun/...`).
  - SourceMod and Metamod:Source for servers that you run (plugins in SourcePawn).
- Code: Source SDK 2013 (github.com/ValveSoftware/source-sdk-2013) builds your own mod, a new game folder under `sourcemods/`.
  This is the official and legal route for new mechanics in HL2-era games.
- Browse: GCFScape or VPKEdit open VPKs.
  Crowbar handles models.
  BSPSource decompiles maps.

## Source 2 (CS2, Dota 2, Half-Life: Alyx, Deadlock)

Identify: the game has `game/bin/win64/engine2.dll` and `game/<mod>/gameinfo.gi`.

- Official tools: the Workshop Tools DLC (Hammer 2, Material Editor, ModelDoc, Particle Editor).
  Addons go in `game/<mod>_addons/<addon>/`, and `-tools` starts the editors.
  - Half-Life: Alyx: VScript Lua.
  - CS2: the map workshop and VScript successors.
    Check the current state, because Valve changes it.
  - Dota 2: custom games (Lua and Panorama UI).
- Read assets: Source 2 Viewer (ValveResourceFormat, VRF) decompiles `_c` resources: models, maps, textures, and collision.
  Keep derived data out of git.

## Rules

- VAC bans modified clients on VAC-secured servers.
  Test with `-insecure` on a local listen server.
  Do not inject into CS2, Dota, Deadlock, or TF2 on official matchmaking.
- The Workshop, maps, custom games, and VScript are the approved routes for the multiplayer titles.
- Demos (`.dem`) are a good oracle for gameplay work.
  DemoFile.Net and the demoparser libraries extract the state of each tick.
