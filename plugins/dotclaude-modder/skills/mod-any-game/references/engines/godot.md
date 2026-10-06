# Godot (3.x and 4.x)

## Identify

A `.pck` file is next to the exe (magic `GDPC`), or the pck is appended to the exe.
`um scan` reads the Godot version from the pck header.

- Game logic is GDScript.
  It is tokenized (`.gdc`) and sometimes encrypted with a key for each game.
  C# (.NET) builds also ship `<Game>.dll` in a `data_*` folder.
  For those, see `dotnet-xna.md`.
- Saves: `%APPDATA%\Godot\app_userdata\<Project>\`, or a custom `user://` folder if `use_custom_user_dir` is set.

## Read the game

- GDRE Tools (gdsdecomp) recovers a whole editable project (scenes, resources, decompiled GDScript) from the pck or exe.
  Open it in the Godot editor of the matching version to understand the structure.
- Encrypted pcks: the key is in the exe, and GDRE Tools can find it for many builds.
  If a game encrypts on purpose, check its mod policy before you go further.

## Routes

1. Godot Mod Loader (github.com/GodotModding/godot-mod-loader), if the game ships with it or the community added it.
   Mods are zip files in `mods/` with a manifest.
   Script extensions hook methods with `extend`.
   Brotato and Dome Keeper use it.
1. PCK overlay: Godot loads extra packs with `ProjectSettings.load_resource_pack("res://mod.pck")`.
   A resource in a later pack overrides an earlier one with the same `res://` path.
   You need code execution to call it, from an injected autoload or a mod loader.
1. `override.cfg` next to the exe overrides project settings.
   `autoload/MyMod="*res://mod/my_mod.gd"` adds an autoload singleton if the script is in a loaded pack.
   With `application/run/main_scene`, you can start your own loader scene.
1. Rebuild: export the recovered project with your changes.
   This is for personal use only.
   Do not redistribute a rebuilt game.

## Content

- Make new scenes and scripts in the editor of the matching version.
  Export a pck with only your files (`--export-pack`).
- Sprites: PNG plus `.import` metadata (the editor makes `.ctex` on export).
  Match the texture filter of the game.
  Use nearest for pixel art.

## Pitfalls

- The editor and runtime versions must match (the resource format changed between 4.2 and 4.3).
- GDScript 2.0 (Godot 4) and 1.0 (Godot 3) are different languages.
- `godot-mcp` can drive the editor for an agent when you build new content.
