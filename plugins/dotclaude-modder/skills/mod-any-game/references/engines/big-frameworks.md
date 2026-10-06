# Big games with community frameworks

These AAA engines have no official mod kit, but the community built one.
Use the framework and do not rebuild it.
Check the GitHub or Nexus page of each framework for the version that matches the game build.

## Capcom RE Engine

Games: Resident Evil 2, 3, 4, 7, and 8, Monster Hunter Rise and Wilds, Devil May Cry 5, Street Fighter 6, and Dragon's Dogma 2.

- REFramework (praydog) goes in the game folder as `dinput8.dll` plus `reframework/`.
  It gives you:
  - Lua scripting (`reframework/autorun/*.lua`) with full access to the managed type system: `sdk.find_type_definition`, `sdk.hook`, and `sdk.call_native_func`
  - an in-game object explorer
  - a free camera
  - VR for many titles
- Asset replacement: files at loose paths under `natives/` (with pak priority), through Fluffy Mod Manager or loose-file loading.
  Browse with RE_RSZ or RETool.
  Extract paks with a file list.
- `REFramework-MCP` exposes the game to an agent.
- Online parts (SF6 ranked, MH lobbies): only cosmetic local mods are the norm.
  Do not use mods that affect gameplay online.

## FromSoftware

Games: Elden Ring, Dark Souls, Sekiro, Armored Core 6, and Nightreign.

- Loaders: ModEngine2 (archived but widely used) or its successor `me3`.
  They load mods from a folder and start the game offline with EAC off.
  This is the only acceptable way.
  Do not go online.
- Data and params (weapons, enemies, spEffects): Smithbox (the successor of DSMapStudio) edits params, maps, text, and models.
  WitchyBND unpacks and repacks BND, DCX, and BDT containers.
- Code: DLL mods that the mod engine loads (hooks with MinHook).
  Seamless Co-op is a separate network.

## Rockstar RAGE (GTA V Legacy and Enhanced, RDR2)

- Story mode only.
  BattlEye protects GTA Online.
  ScriptHookV refuses to run online, and mods must stay away from GTA Online.
- Scripts: ScriptHookV (and ScriptHookVDotNet for C#) plus Ultimate ASI Loader (`dinput8.dll`, `*.asi` plugins).
  NativeDB lists the callable game functions.
  RDR2 uses ScriptHookRDR2 and Lenny's Mod Loader.
- Assets: OpenIV (use a `mods/` folder copy of the RPFs and do not edit the originals), and CodeWalker for maps.
- LSPDFR-style frameworks exist for specific genres.
- Facts from the Minecraft and GTA V project (`um kb search "minecraft passthrough"`):
  - Launch: start story mode with BattlEye off (`-nobattleye` in `args.txt`, or the toggle of the launcher).
    This also keeps Online from starting.
  - ReShade must load through the ASI loader.
    GTA loads the system `dxgi.dll` before a proxy in its folder.
  - Downloads: dev-c.com (ScriptHookV) rejects scripted downloads that lack browser headers.
  - Script lifecycle:
    - The pause menu stops ScriptHookV scripts.
    - The idle cinematic camera starts after about 30 seconds.
      Call `INVALIDATE_IDLE_CAM` each frame.
    - `IS_GAMEPLAY_CAM_SHAKING` does not report the camera shake of explosions.
  - Camera timing: a script reads the camera for the frame in preparation, one frame ahead of the screen.

## CD Projekt REDengine

- Cyberpunk 2077:
  - REDmod (official): archives and tweaks
  - Cyber Engine Tweaks: Lua, console, and overlay
  - RED4ext: native plugins
  - ArchiveXL and TweakXL: new items and records
  - [WolvenKit](https://github.com/WolvenKit/WolvenKit): projects and asset export and import
  - The [REDmodding wiki](https://wiki.redmodding.org/cyberpunk-2077-modding) documents all of them.
- The Witcher 3: REDkit (the official editor), and script mods (`.ws` files, merged with Script Merger).

## Larian (Baldur's Gate 3)

Use the official mod.io toolkit, the Script Extender (Norbyte) for Lua, and LSLib or the BG3 Modder's Multitool for `.pak` files.

## Paradox, Total War, XCOM, and others

Many strategy games ship official tools:

- Paradox: plain-text script mods (see `misc-engines.md`)
- Total War: RPFM (Rusted PackFile Manager)
- XCOM 2: the WOTC SDK
- Cities: Skylines: C# mods

Search "<game> modding wiki" before you reverse engineer anything.

## Frostbite (Battlefield, Mass Effect Andromeda, Dragon Age, FIFA)

The Frosty Tool Suite supports specific single-player titles.
Most modern Frostbite games ship the EA Javelin kernel anti-cheat.
For them, work only in offline single-player mode, if at all.
