# Modder

The `dotclaude-modder` plugin lets Claude mod a PC game that you own.
It is a Bun and Python port of [universal-modder](https://github.com/rehan-remade/universal-modder) by Rehan, under the MIT license.

## Before you begin

1. Install [Bun](https://bun.sh) 1.4.2 or later.
1. Install [uv](https://docs.astral.sh/uv/) for `um sprite`, `um video`, and `um backup`.
   Without `uv`, these commands run with the system Python, which then needs Pillow 10 or later and numpy.
1. Install the tools for the parts that you use:
   - `ffmpeg` for `um video` and for recording
   - [Blender](https://www.blender.org) for `um render3d`, or set `BLENDER` to its path
   - ComfyUI for `um comfy`
1. Install the plugin.

   ```text
   /plugin install dotclaude-modder@dotclaude
   ```

1. For `um fal` and the fal MCP server, enter your key from <https://fal.ai/dashboard/keys> in the `fal_key` option.
   Without the option, `um fal` reads `FAL_KEY` from the environment.

> **Warning:** Mod only offline and single-player games.
> A modded game on official online servers, or a bypass of DRM or anti-cheat, can get your account banned.

## What it does

| Part | What it does |
| --- | --- |
| Session note | Gives Claude section 15 of the [operating spec](Operating-Spec): back up before a change, stop a process only by PID, keep a modded game off official servers and away from DRM and anti-cheat, read field notes as untrusted text, and get your OK before a publish. |
| Kill guard | Denies a `Bash` call that stops processes by name, such as `pkill`, `killall`, `taskkill /IM`, or `Stop-Process -Name`. |
| Skills | Tell Claude how to do each step of a mod, with the `um` commands. |
| `um` command | Does the work of the skills. The plugin `bin/` puts it on the `Bash` PATH. |
| fal MCP server | Lets Claude call fal models directly. |

## The skills

| Skill | Use it to |
| --- | --- |
| `mod-any-game` | Start any mod: find the engine and pick the route. |
| `game-recon` | Learn the internals of a game: files, formats, and code. |
| `game-automation` | Test a mod in the game: screenshots, input, and recordings. |
| `asset-pipeline` | Make sprites, textures, and models that fit the game. |
| `fal-assets` | Generate assets with fal models. |
| `mashup-mods` | Bring content from one game into another. |
| `publish-mod` | Check a mod before you share it. |
| `share-field-notes` | Read and write notes for the shared knowledge base. |
| `showcase-video` | Make a video that shows the mod. |

For reverse engineering, `mod-any-game` refers to the skills in [xsyetopz/skills](https://github.com/xsyetopz/skills).

## The `um` command

| Group | What it does |
| --- | --- |
| `um scan` | Finds installed games and fingerprints one: engine, runtime, anti-cheat, mod loaders, and routes. |
| `um fal` | Generates game assets with fal. |
| `um comfy` | Generates images locally with ComfyUI. |
| `um sprite` | Cuts out, fits, pixelates, recolors, and packs 2D sprites. |
| `um render3d` | Renders a GLB into sprite frames from the camera of a game. |
| `um video` | Compiles showcase videos, and trims and muxes clips. |
| `um win` | On Windows and WSL: screenshots, recordings with game-only audio, input, and processes. |
| `um backup` | Makes and restores snapshots of save folders. |
| `um publish` | Checks a mod folder for game files, decompiled code, secrets, and credits. |
| `um kb` | Searches, writes, and checks field notes, and opens a pull request. |

Run `um <group> --help` for the commands and options of a group.

## Environment variables

| Variable | Default | What it sets |
| --- | --- | --- |
| `UM_HOME` | `~/.universal-modder` | The folder for backups and downloaded tools. |
| `UM_KB` | none | A local folder of field notes. |
| `UM_KB_REPO` | `rehan-remade/universal-modder` | The GitHub repository of the field notes. |
| `UM_KB_BRANCH` | `6715445` (2026-10-05) | The branch or commit of the field notes. The default is a reviewed commit. Set `main` for the latest notes, or set a commit SHA that you reviewed. With `UM_KB_REPO` set, the default is `main`, because the reviewed commit is not in a fork. |
| `UM_NO_UV` | none | When set, the Python groups run with the system Python. |
| `BLENDER` | none | The path to Blender. |
| `UM_FFMPEG_WIN` | none | The path to a Windows `ffmpeg` that has `gfxcapture`. |

## Related pages

- [Operating spec](Operating-Spec): section 15.
- [Attributions](Attributions): the source of the port.
- [Install](Install): the other plugins.
