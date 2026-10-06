# Genie engine: Age of Empires II DE (and AoE1 DE)

## Identify

The game has `AoE2DE_s.exe` and `resources/_common/dat/empires2_x2_p1.dat`.

- Profile: `%USERPROFILE%\Games\Age of Empires 2 DE\<steamid>\` holds `mods/local/`, `mods/subscribed/`, scenarios, and saves.
- There is no anti-cheat for single-player and lobbies.
  Ranked play always uses unmodded data.
- `case-studies.md` has the full pipeline of a new civilization with units rendered from 3D.
  It is the fastest way to avoid a day of dead ends.

## Mod kinds

A local mod is a folder `mods/local/<Mod>/` that mirrors `resources/`.

- Data mod: a modified `resources/_common/dat/empires2_x2_p1.dat`.
  It applies only when chosen in the "Data Mod" dropdown of the skirmish lobby.
  The Mod Manager shows a gear icon, not a checkbox.
  Edit it with `genieutils-py` (Python: units, techs, civs, effects, graphics, sounds) or the Advanced Genie Editor (AGE, a GUI).
- Graphics mod: `resources/_common/drs/graphics/*.sld` sprites.
  - SLD has BC1 and BC4 compressed layers: main, shadow, damage mask, and player colour.
  - Unit sprites have 16 headings (clockwise from east) and a canvas with a hotspot at the ground point of the unit.
  - Render them from 3D with `um render3d <model.glb> <outdir> --preset aoe2 --shadows`.
    Mask the player colour with `um sprite team-mask`.
  - No SLD reader or writer is in this plugin.
    Write one from the stock files, and check it with a round trip (decode, encode, decode, compare) on a stock sprite.
- Menu art and tech tree:
  - Art is in `resources/_common/wpfg/resources/` (`uniticons/`, `civ_emblems/`, and `civ_techtree/`).
  - The data for the civ picker and tech tree is in `resources/_common/dat/civilizations.json`, `unitlines.json`, and `futuravailableunits.json`.
    Copy the stock files and edit the entries of your civ.
- Strings: `resources/en/strings/key-value/key-value-modded-strings-utf8.txt` (`id "text"`).
- Scenarios: `AoE2ScenarioParser` (Python) builds `.aoe2scenario` files with units, triggers, and camera moves.
  They are good for scripted test scenes and demo takes.

## Facts to know

- The civ picker has hard-coded limits.
  It lists only the civs in the civ table of the executable (index-based UI tables).
  To add a civ, replace a slot (for example the Burgundians, 36).
  Copy the tech tree of a base civ and overwrite the name, strings, and art.
  Extra civs load but do not show in the picker.
- Help strings: DE keeps the DLL help strings at `id - 79000` in the key-value files (Knight help 105068 is key 26068).
  New string ids must be unused in the stock tables.
- Icons of the command panel come from the prebuilt `widgetui` atlas of the base game, and a local mod cannot extend it.
  Use stock icon ids in the game and your art in menus and the tech tree.
- Castle unique units need `creatable_type` 2.
  Tech 266 ("Castle built") does not fire for castles that a scenario places, so use Castle Age instead.
- Append, do not remove.
  Deep-copy template units, graphics, and techs, and append them.
  Stable indices keep the other civs unchanged.
- Windowed mode for automation: in the registry key `HKCU\Software\Microsoft\Microsoft Games\Age of Empires II DE`, set `Mode Display` to 0.
  Then set `Windowed Width` and `Windowed Height` to any size (1936x1119 gives a 1920x1080 client area).
  Use `um win reg get` and `um win reg set`.
- Crashes: a crash leaves `BsSndRpt64.exe` (BugSplat) running, and Steam refuses to relaunch until you stop it.
  Find the PID with `um win ps`, and stop it with `um win kill <pid>`.
