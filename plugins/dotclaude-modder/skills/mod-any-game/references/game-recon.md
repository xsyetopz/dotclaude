# Game recon

<task>
In about five minutes, learn what the game is and which modding route to take.
Write the answer down, so each later step can rely on it.
</task>

<steps>
## 0. Check for notes of other agents

Run `um kb search "<game>"` and `um kb search "<engine>"`.
A field note can give the working versions, the route, and the gotchas before you touch anything.
Add `--remote` when no local clone exists.
`share-field-notes.md` explains how notes work.

## 1. Find the game and fingerprint it

```bash
um scan --list                 # Steam, Epic and Xbox installs on this machine
um scan "<name or folder>"     # engine, runtime, anti-cheat, loaders, saves, routes
um scan "<game>" --json        # the same report, machine-readable
```

The report ends with ranked modding routes and a playbook path in the form `skills/mod-any-game/references/engines/<file>.md`.
That file is in the `engines` folder next to this file.
Read it.

The scan can miss things, so check these by hand:

- Game not in a store library (GOG, itch, a standalone folder): pass the folder path to `um scan`.
- Signals of several engines: launchers and web helpers are common.
  The top score wins, but read the "also" line.
- Anti-cheat installed elsewhere: kernel drivers (the `vgk.sys` of Vanguard) and protection at the launcher level are not in the game folder.
  Search "<game> anti-cheat".
- Online-only or live-service games: treat them as protected, even if the scan detected nothing.

## 2. Research the community as it is now

Versions move, so do not use memory.
Search in this order:

1. "<game> modding", "<game> mod loader", and "<game> modding wiki".
   The wiki of the game often has a modding page.
1. Nexus Mods (the most popular mods show which frameworks they need), Thunderstore (BepInEx packs for Unity games), mod.io, and the Steam Workshop.
1. GitHub: "<game> mod", "<game> modding api", "<game> decompile", "<game> sdk", and "<engine> mod loader".
1. Recent posts (X, Reddit, Discord announcements) for new frameworks.
   A loader can be days old.

Record the name of the loader, its repository, its current version and install steps, the game versions that it supports, a hello-world example mod, and the place of its logs.

## 3. Decide

- Can the game be modded safely?
  Check the anti-cheat, the online-only parts, the EULA or mod policy, and the ownership checks that loaders rely on.
  Read `safety.md` next to this file.
  If the answer is no, tell the user.
  Offer what is possible: official tools, offline modes, or another game with the same idea.
- Route: prefer a loader API, then a data or asset mod, then managed patching, then native hooks, then reimplementation or a mashup.
  Pick the first one that reaches the idea of the user.

## 4. Write MODDING_PLAN.md

```markdown
# <Game> modding plan
- Install: <path> (<store> <appid>), version <x>
- Engine: <engine + version>, code: managed .NET / IL2CPP / native, 64-bit
- Anti-cheat / online: <none | what + verdict>
- Saves: <path>   Config: <path>   Logs: <path>
- Community route: <loader vX.Y (repo)>, install: <steps>, example mod: <link>
- Chosen route for "<idea>": <route> because <reason>
- Lab plan: backup <folders> (um backup), lab profile <how>, windowed <how>
- Unknowns to resolve first: <list>
```

Then continue with the loop of the `mod-any-game` skill: lab setup, source of truth, and vertical slice.
</steps>
