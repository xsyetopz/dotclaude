# Retro and console games: decomps, recomps, emulators

The user must own the game and dump it.
Do not download ROMs, ISOs, leaked source, or leaked builds.
You can use knowledge from leaks.
Some projects refuse anything built on leaked material ("leak poisoning"), and clean decomps such as libsm64 get adopted.
Check the rules of a project before you contribute.

For binary analysis, matching decompilation, emulator debugging, patches, and recompilation, use the skills in <https://github.com/xsyetopz/skills>.
`SKILL.md` lists them.

## Is there already a decompilation or port?

Many classics have matching decompilations (C source that compiles back to the identical ROM) and native PC ports built on them:

- Super Mario 64: the `sm64` decomp, `sm64coopdx` (Lua mods, online co-op), and libsm64 (SM64 as a library that other engines embed, for example G64 in Garry's Mod)
- Ocarina of Time and Majora's Mask: decomps, Ship of Harkinian, and 2 Ship 2 Harkinian
- Zelda64Recomp
- Twilight Princess (Dusklight)
- Super Mario Sunshine, Mario Kart 64, Pokémon (pret: pokered, pokeemerald, and others), Sonic, and Metroid

Search "<game> decomp", "<game> recomp", and "<game> pc port" first.
To mod a decomp, edit the C code (or the Lua API of the port) and build with your own ROM as the asset source.
Minecraft inside Mario 64 was built on sm64coopdx.
A new Majora's Mask area was built by Opus on the MM recomp.

## Static recompilation (no source, still native)

Recompilers translate machine code into C that links against a runtime that reimplements the console:

- N64: N64Recomp and N64ModernRuntime (with the RT64 renderer)
- Xbox 360: XenonRecomp or ReXGlue
- PS2: PS2Recomp
- GameCube and Wii: DolRecomp
- PS1: psxrecomp or RecompOne

A recomp is also the best oracle for a clean reimplementation.
Run it or read it to get ground truth, then write an idiomatic engine.
The Skate 3 Rust engine was built this way.

## Start a decompilation with agents

Tools:

- splat splits the ROM into asm and data.
- m2c gives a first C decompile.
- asm-differ and objdiff compare your compiled function to the original.
- decomp-permuter searches for code shapes that match.
- decomp.me shares scratches.

The agent loop that worked in public write-ups (one N64 game: 2,145 functions in 84 days):

- Work on one function at a time, with a `build-and-verify` script that shows how close the result is.
- Keep each attempt in its own file, with a hard cap of about 10 attempts.
  Then move on and log it.
- Commit each match, and keep a shared `LEARNINGS.md`.
- Rank candidates cheapest first (instructions, branches, jumps).
- Run several worktrees in parallel, and try another model on the hard functions.

Do mechanical decompilation first, and modernization and portability afterwards.
Plan the budget, because a large decomp can take billions of tokens.

## Emulator-based mods (no source needed)

- Memory scripting: BizHawk Lua, mGBA Lua and scripting, Dolphin Memory Engine, PCSX2 PINE, and RetroArch cheats.
  Find addresses with RAM search.
  `mgba-mcp` and PCSX2-MCP expose this to agents.
- ROM hacks: patch code or data in the ROM and distribute an IPS, BPS, or xdelta patch.
  Do not distribute the ROM.
  Existing editors include Lunar Magic (SMW), the SZS tools of Wiimm (Mario Kart Wii tracks), and Pokémon hacking tools.
- Dolphin: texture packs, Gecko and AR codes, and Riivolution patches for GameCube and Wii.

## Pitfalls

- Some recomp and decomp communities ban AI-generated contributions.
  Follow the rules of each project and say that AI helped.
- Publishers send DMCA notices for recomps and ports, even without assets.
  Keep projects non-commercial and ship only patches and tools.
