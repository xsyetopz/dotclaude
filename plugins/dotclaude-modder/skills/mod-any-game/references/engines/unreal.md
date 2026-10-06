# Unreal Engine (4 and 5)

## Identify

The game has `<Project>/Binaries/Win64/<Project>-Win64-Shipping.exe` and `<Project>/Content/Paks/*.pak`.

- UE 4.26 and later, and UE5: assets are in IoStore `.utoc` and `.ucas` files next to a small `.pak`.
- Engine version: `um scan` searches the exe for `++UE5+Release-5.x`.
- Saves: `%LOCALAPPDATA%\<Project>\Saved\SaveGames`.
  Config is in `...\Saved\Config\Windows\*.ini`.
  Many tweaks need only ini files (`Engine.ini`, with cvars in `[SystemSettings]`).

## Route 1: UE4SS (scripting and hooks, no engine recompile)

RE-UE4SS (github.com/UE4SS-RE/RE-UE4SS) injects into the game.
Put its `dwmapi.dll` (newer builds) or its `xinput1_3.dll` proxy, plus the `ue4ss/` folder, next to the shipping exe.

UE4SS gives you:

- Lua mods (`ue4ss/Mods/<Mod>/Scripts/main.lua`, enabled in `mods.txt`):
  - `RegisterHook("/Script/Engine.PlayerController:ClientRestart", fn)`
  - `NotifyOnNewObject`
  - `FindFirstOf("PlayerCharacter")`
  - read and write of any UProperty, and calls to UFunctions
  - `ExecuteInGameThread`
- C++ mods for heavier work.
- The Live View, an object dumper and inspector in the GUI console.
  Use it to find the class and property that you need.
- An SDK and header generator that dumps a UHT-compatible SDK.
  Dumper-7 is an alternative.
- Blueprint mods: UE4SS loads `LogicMod` blueprint paks from `Content/Paks/LogicMods`.

Check that UE4SS works with the game.
Custom engine forks may need a UE4SS config override for AOBs.
Read the UE4SS example mods before you plan features, because many features exist there.

## Route 2: pak mods (asset and blueprint replacement)

- Browse with FModel (CUE4Parse).
  It needs the right UE version, and the AES key when paks are encrypted.
  Keys are public for most games, and AESDumpster extracts them from the exe.
- Edit `.uasset` files with UAssetGUI or UAssetAPI (JSON round trip).
  Or cook replacements in a UE editor of the matching version, with the same project name and paths.
- Pack with repak (`repak pack --version V11 mymod_P/`), or with retoc for IoStore.
  Name the file `*_P.pak`, so it outranks the originals, and put it in `Content/Paks/~mods/`.
- For new content (meshes, materials, blueprints), cook in the UE editor of the same version (Epic launcher or a source build).
  Then pak only your cooked files.
  The mount point and paths must mirror the game (`/Game/...`).

## Route 3: VR, camera, and engine tweaks

- UEVR (praydog) injects stereo VR into most UE4 and UE5 games, with profiles for each game.
- Console unlockers (Universal Unreal Console Unlocker, or UE4SS) enable `stat fps`, `slomo`, and the `r.*` cvars.
  They help with showcase shots: free camera, slow motion, and hidden HUD.

## Read the game

- Use the UE4SS dump, or Dumper-7, for class, property, and function names with offsets.
- Use Ghidra or IDA on the shipping exe for native gameplay code.
  Match the UE source (github.com/EpicGames, with account linking) to name engine functions.
- `fmodel-mcp` lets an agent browse assets.

## Pitfalls

- Anti-cheat: EAC or BattlEye titles (Fortnite and most online UE games) are off limits.
- Version mismatch: paks cooked for the wrong UE version crash on mount.
  Blueprint mods break when the game updates.
- Signatures: games with `.sig` files verify paks.
  Do not work around this check.
  If a mod needs it removed, stop and tell the user.
- UE5 games that stream everything through IoStore need retoc, not repak.
