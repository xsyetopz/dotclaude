# Other engines, quick routes

## GameMaker (`data.win`, `game.unx`)

- UndertaleModTool (UTMT) opens `data.win`.
  It gives GML decompile and recompile, sprites, rooms, sounds, and fonts.
  It also runs C# scripts for batch edits (a CLI build exists for automation).
  It covers Undertale, Deltarune, Pizza Tower, and most GMS2 games.
  The YYC (compiled) export is native code, so use `native.md` for it.
- Back up `data.win`.
  Distribute mods as xdelta patches.
  Do not distribute the modified `data.win`.

## RPG Maker

- MV and MZ (NW.js and JavaScript):
  - Plugins are JS files in `js/plugins/`, registered in `js/plugins.js`.
  - The database is `data/*.json` (actors, items, maps, events).
  - Encrypted assets (`.rpgmvp`, `.png_`) use a key in `data/System.json`, and decrypters exist.
  - Press F12 or F8 for devtools in playtest builds, or enable them in `package.json`.
- XP, VX, and VX Ace (Ruby RGSS):
  - Scripts are in `Data/Scripts.rxdata`, `.rvdata`, or `.rvdata2` (Marshal-serialized, zlib-compressed Ruby).
  - Encrypted archives are `Game.rgssad`, `.rgss2a`, or `.rgss3a`, and extractors exist.
  - For RPG Maker 2000 and 2003, see liblcf of EasyRPG.

## Ren'Py (`renpy/`, `game/*.rpa`)

Read with `unrpa` (archives) and `unrpyc` (compiled scripts).
Mods are extra `.rpy` files in `game/`: new labels and screens, `config` overrides, and `init` blocks with higher priority.
Enable the Ren'Py console (Shift+O) with `config.developer = True`.

## Paradox (Clausewitz and Jomini: EU4, CK3, HOI4, Stellaris, Victoria 3)

Mods are plain-text scripts in `Documents/Paradox Interactive/<Game>/mod/<mod>/` with a `.mod` descriptor.
Newer games use `.metadata/metadata.json`.
Everything is data: events, decisions, units, and GUI.
The error log is `logs/error.log`.
The official wikis document each trigger and effect.

## id Tech and the Doom family

- Classic Doom: WAD or PK3 mods on a source port (GZDoom or UZDoom) with ZScript or DECORATE.
  Edit maps with Ultimate Doom Builder, and inspect files with SLADE.
- Quake: `pak0.pak` and QuakeC.
  The source releases of Quake 2 and 3 allow total conversions.
- Newer idTech (DOOM Eternal): community tools only, offline.

## HTML5, Electron, and NW.js games

- Electron: `resources/app.asar`.
  Extract with `npx @electron/asar extract app.asar app/`, patch the JS, and repack.
  Or use the folder `resources/app/`, which the game then prefers.
- NW.js: `package.nw` or loose files.
  Open devtools with `"chromium-args": "--remote-debugging-port=9222"` in `package.json`, or with `nw.Window.get().showDevTools()`.
- Construct (`c3runtime.js`), Phaser, and PixiJS: the logic is plain JS.
  Construct compiles event sheets into the runtime JSON.
- For browser games that you control, the devtools console is your mod loader.

## LÖVE (Lua)

The game is a zip, either a `.love` file or zip data appended to the exe.
Unzip it and read the Lua.
For mods without repacking, use injection frameworks.
Balatro uses `lovely` (Lua patch injection) and Steamodded.

## Java games (not Minecraft)

- Decompile jars with Vineflower, CFR, or Procyon.
  Recaf edits and decompiles.
- Community loaders:
  - Slay the Spire: ModTheSpire and BaseMod, with `@SpirePatch`
  - Starsector: the official mod API
  - Project Zomboid: Lua mods plus Java
- Otherwise use a Java agent (`-javaagent`) with ASM or ByteBuddy, or use Mixin.

## Defold, Cocos2d-x, and Haxe or OpenFL

- Defold: `game.arcd` and `.arci` archives, and Lua scripts.
  Unpackers exist.
- Cocos2d-x: Lua or JS bundles (sometimes XXTEA-encrypted, with the key in the binary).
  Otherwise the game is native.
- HaxeFlixel and OpenFL: `assets/` overrides.
  Some games embed Polymod (hscript) mod support.
