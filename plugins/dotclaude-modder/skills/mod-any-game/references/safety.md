# Safety, legality, etiquette

These rules keep the accounts, saves, and machine of the user safe, and keep the mod shareable.
This text is not legal advice.
When the EULA or mod policy of a game matters, read it.
Search for "<publisher> mod policy".

## Online games and anti-cheat

- Work only in single-player or offline mode, or on servers that the user runs.
  Injection into an online client breaks its terms and gets accounts banned.
  Injection to gain an advantage over other players is cheating.
  Refuse aimbots, ESP and wallhacks, speed and teleport hacks, recoil scripts, and packet manipulation for multiplayer games.
  The framing of the request does not change this.
- Kernel or user-mode anti-cheat is a stop sign for code injection.
  This covers EasyAntiCheat, BattlEye, Vanguard, EA Javelin, Ricochet, ACE, nProtect, XIGNCODE, and mhyprot.
  Allowed work:
  - official modding surfaces such as the Workshop, creative editors, map editors, and official mod kits
  - an official offline mode that ships without the anti-cheat
- Elden Ring started offline through `ModEngine2` or `me3` with EAC off is the community norm.
  Seamless co-op is a separate network.
- Do not do any of these:
  - disable or bypass anti-cheat
  - spoof hardware IDs
  - tamper with DRM (Denuvo, the Steam stub) or with ownership checks

  If a loader needs a patch of the game EXE to get past DRM, stop and tell the user.
- VAC (Valve) bans modified clients on VAC-secured servers.
  Run local tests with `-insecure`.
  Do not join public servers while anything is injected.
- Tools that run next to a protected game can trip its anti-cheat, even when you do not touch the game.
  Debuggers, Cheat Engine, and injecting overlays are examples.
  Close protected games before a reverse-engineering session.

## Ownership and redistribution

- Mod games that the user owns.
  Use the install of the user, or dumps of cartridges and discs that the user owns.
  Do not download ROMs, ISOs, or game files.
- If the user cannot buy the title, for example a delisted or region-locked game, say so.
  A community route may exist for such a title.
  Do not give steps, keys, or links for it.
  Offer another game, an official mod kit, or an official offline mode.
- Do not publish any of these:
  - game files, or byte-identical copies of them
  - extracted assets
  - decompiled source
  - retail offsets or decompiler names baked into shipped code

  `um publish check <mod> --game <install>` catches the obvious cases.
- Publish these:
  - your own code and assets (the output of fal is yours under the terms of fal, so check the license of the model for commercial use)
  - patches, diffs, and converters or installers that change the files of the user at install time
- Credit loaders, libraries, and references, and say that AI helped.
  Communities react badly to undisclosed AI releases.
  Some communities, such as certain recomp Discords, ban AI projects.
- Takedowns happen, even when a project has no assets.
  Take-Two had GitHub remove re3 and reVC, the reverse-engineered code of GTA III and Vice City, and then sued the authors ([2021](https://www.pcgamesn.com/gta-3-takedown)).
  Activision sent the H2M mod a cease-and-desist letter the day before its launch ([2024](https://www.videogameschronicle.com/news/activision-issues-cease-and-desist-to-modern-warfare-remastered-mod-that-shot-it-back-up-the-steam-charts/)).
  Commercial use, money, and leaked material raise the risk.
  You can use knowledge from betas and leaks.
  Do not ship leaked code or builds, or a mod that runs only with them.

## The machine of the user

- Run `um backup create` for saves, profiles, and config before any modded launch.
  Restore must be one command, and `MODLOG.md` must record it.
- Loaders and proxy DLLs (`winhttp.dll`, `version.dll`, `dinput8.dll`, `dxgi.dll`) sit in the game folder.
  Tell the user what you added and how to remove it.
  A separate copy of the game, or a mod manager profile, is better.
- `um win reg set` backs up the key before it changes it.
  Write down what changed.
- Input automation takes over the mouse and keyboard of the user.
  - Run `um win drive --proc <name> idle`.
    A small number means that the user is active.
  - Ask before long automated runs.
  - WinDrive sends input only while the game is in the foreground.
- Stop a process by its exact PID.
  A name pattern in an agent shell can match the shell of the agent.
  A hook denies `pkill`, `killall`, `taskkill /IM`, and `Stop-Process -Name`.
  Run `um win ps` to find the PID, then `um win kill <pid>`.
- Do not leave topmost windows (`untop` removes the flag), global hooks, or orphaned ffmpeg and PowerShell processes.
- Bind each bridge, debugger, or MCP server that you add to `127.0.0.1` with a token.
  Some reverse-engineering tools bind `0.0.0.0` by default.
- A viral mod often has a download link that holds malware.
  Run loaders only from their official repositories and releases.

## When to stop and ask

- The game has online parts with anti-cheat, and the idea touches them.
- The only route is a bypass of a protection.
- A step deletes or overwrites saves or game files without a backup.
- Publishing.
  The user decides.
