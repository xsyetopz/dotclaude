# Bethesda: Creation Engine and Gamebryo

Games: Skyrim, Fallout 3, New Vegas, 4, and 76, Oblivion, and Starfield.

## Identify

The game has `Data/*.esm` plus `*.bsa` or `*.ba2` archives next to `SkyrimSE.exe`, `Fallout4.exe`, `Starfield.exe`, and so on.

- Saves and INI files: `Documents/My Games/<Game>/` (`Skyrim.ini`, `SkyrimPrefs.ini`, `Saves/`).
- Fallout 76 is online-only.
  Do not make client mods for it.

## Use a mod manager for isolation

Mod Organizer 2 (MO2) runs the game in a virtual file system with profiles.
It does not touch `Data/`, unlike a manual install.
Make one MO2 instance for each project and one profile for each experiment.
[Vortex](https://github.com/Nexus-Mods/Vortex) is the alternative.
On Linux, [Amethyst](https://github.com/ChrisDKN/Amethyst-Mod-Manager) manages mods natively.
Get mod managers only from these official pages.
Look-alike repositories with a zip in their releases are a common way to spread malware.

## Routes

1. Plugins (`.esp`, `.esm`, `.esl`): records for weapons, NPCs, quests, cells, and leveled lists.
   - Edit in xEdit (SSEEdit, FO4Edit, or xEdit).
     It has Pascal scripting.
   - The Creation Kit (from Steam) handles cells, navmesh, dialogue, and quests.
   - Give small plugins the ESL flag to save load-order slots.
   - Plugins are structured records, so an agent can generate them, for example with `esplugin`, `xelib`, or xEdit scripts.
     A public Fallout NV project generated and validated ESPs from Python scripts.
1. Papyrus scripts (`.psc`, compiled to `.pex`): event-driven game logic attached to records.
   Compile with the PapyrusCompiler of the Creation Kit.
1. Script extender native plugins, for what Papyrus cannot do: new functions, hooks, UI, physics, and passthrough rendering.
   - The extenders are SKSE64 (Skyrim SE and AE), F4SE, xNVSE, OBSE, and SFSE.
   - Build in C++ with CommonLibSSE-NG (Skyrim) or CommonLibF4.
   - Address Library resolves function IDs that do not depend on the version.
   - Plugins go in `Data/SKSE/Plugins/*.dll`.
     Logs are in `Documents/My Games/<Game>/SKSE/`.
1. Assets:
   - Meshes are NIF files.
     Edit them with NifSkope, and export from Blender with PyNifly.
   - Textures are DDS BC1, BC3, or BC7.
   - Archives: use BSArch or Archive2 to pack BSA and BA2 files.
   - Animation uses Havok behavior files, which are hard to edit.
     Mods reuse existing behaviors.

## Agent workflow tips

- Read records and do not guess.
  xEdit can dump plugins to text, and `xelib` automates it.
- Load order matters.
  Use LOOT to sort, and check conflicts in xEdit (red means conflict).
- A bridge pattern works well.
  A small SKSE or xNVSE plugin captures events and calls a heavier backend outside the process over localhost (file drop or HTTP).
  AI-NPC mods and cross-game passthrough mods use it (see the `mashup-mods` skill).

## Pitfalls

- Game updates break script-extender plugins.
  Pin the game version, or use Address Library.
- Save bloat: removing scripted mods in the middle of a save can corrupt it.
  Test on a throwaway save.
- Creation Club and Anniversary content change the masters.
  Know your ESM list.
