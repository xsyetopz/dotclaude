# .NET games: XNA, FNA, MonoGame, and similar

## Identify

The exe is a managed assembly (`um scan` shows `.NET`).
Look for `FNA.dll`, `MonoGame.Framework.dll` or `Microsoft.Xna.Framework*.dll`, and `Content/*.xnb`.
Examples are Terraria, Stardew Valley, Celeste, and many indie games.
The whole game is readable C#, and patching is well supported.

## Known loaders (use them)

### Terraria with tModLoader

- tModLoader is a free Steam app (1281930).
  It must be in the Steam library.
  Do not bypass that check.
- Mods are C# in `Documents/My Games/Terraria/tModLoader/ModSources/<Mod>/`.
  Build them in the game with Workshop, Develop Mods, Build + Reload.
  Or build from the command line with the `tModLoader.targets` file that the game generates.
- Content classes:
  - `ModItem`: `SetDefaults`, `Shoot`, `UseItem`, `AddRecipes`
  - `ModProjectile`: `AI`, `PreDraw`, `OnHitNPC`
  - `ModNPC`: `AI`, `FindFrame`, and `SetStaticDefaults` with `Main.npcFrameCount`
  - `ModSystem`: world hooks and UI
  - `ModPlayer`
  - `ModCommand`: chat commands, good for tests (for example `/arsenal`)
  - `GlobalNPC` and `GlobalItem` change vanilla content
- Art: PNG files next to the class (`Texture => "Mod/Assets/Name"`).
  NPC sheets are vertical strips, and the frame height is the texture height divided by `npcFrameCount`.
- Lab: `-tmlsavedirectory <dir>` isolates saves.
  `-skipselect Player:World` loads straight in.
  `Main.instance.InactiveSleepTime = TimeSpan.Zero` keeps full speed when the window is not focused.
- Hooks into vanilla methods: `On_Main.DoUpdate += ...` (detours) and `IL_*` (IL edits).
  They use MonoMod, which is part of tModLoader.
- Logs: `tModLoader-Logs/client.log`.

### Stardew Valley with SMAPI

- Plain content changes (sprites, dialogue, maps, data): use Content Patcher packs (JSON).
- Code: SMAPI C# mods.
  - `ModEntry : Mod`
  - `helper.Events.GameLoop.UpdateTicked`
  - `helper.GameContent` for asset edits
  - Harmony for patches
- Use the NuGet package `Pathoschild.Stardew.ModBuildConfig`.
  It finds the game and deploys the mod.

### Celeste with Everest

- Install with the Olympus installer.
- Code mods use MonoMod hooks (`On.Celeste.Player.Update += ...`).
- Build maps with Lönn.

### Others

BepInEx also loads into many plain .NET and Mono games, not only Unity games.
Otherwise use MonoMod or HarmonyX with a small launcher.

## Read the game

- Run `ilspycmd -p -o ~/<game>-decomp <Game>.exe`.
  Keep the output outside the repository.
- The .NET SDK gives you ilspycmd: `dotnet tool install -g ilspycmd`.
- dnSpyEx steps through code with a debugger.
- The decompile is the spec.
  Port logic from it and do not guess.

## Assets

- `.xnb` is compiled XNA content.
  Loaders usually let you ship plain PNG and WAV files instead.
  tModLoader loads PNG directly, and SMAPI loads PNG, JSON, and TMX.
  To unpack stock `.xnb` files for reference, use `xnbcli` or StardewXnbHack.
- Match the pixel scale and outline style of the game.
  Terraria sprites are 2x-scaled pixel art with dark outlines.

## Pitfalls

- 32-bit and 64-bit: the old XNA Terraria is x86.
  tModLoader and FNA builds are x64 .NET 8.
- Gameplay mods work in single-player unless every client has the mod.
  tModLoader syncs mods in multiplayer if `side = Both`.
- Do not ship decompiled code.
  Use hooks and your own code.
