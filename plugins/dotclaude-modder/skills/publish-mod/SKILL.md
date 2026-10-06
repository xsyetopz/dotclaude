---
name: publish-mod
description: Prepares a finished game mod for release, with a lint for game files, decompiled code, and leaked keys, the package layout of the target platform, a README with credits and an AI disclosure, a version and changelog, and a draft of the post. Use when the user wants to ship, share, upload, release, or post a mod.
allowed-tools: Bash(um publish check *)
---

<task>
Get a mod ready to share.
A publish, an upload, or a post goes public and uses the accounts of the user.
Get the OK of the user before each one, and show the user what goes out.
Do the preparation yourself.
Let the user press the button, or run the step only after a clear OK.
</task>

<lint>
Run the check first, and run it again after each fix.

```bash
um publish check ./MyMod --game "<game install folder>"
```

- FAIL: a file that is byte-identical to a game file, a leaked key (fal, Anthropic, OpenAI, GitHub, AWS), a private key, or a `.env` file.
- WARN: a decompiler fingerprint in source (`FUN_`, `DAT_`, or `sub_` names, a "Decompiled with" header), a large engine archive, an absolute user path, no README or credits, or fal assets without a credit line.

Fix each FAIL.
Decide on each WARN, and tell the user the decision.
For example, AoE2 data mods ship a changed `.dat` file, which is the norm of that platform.
The check is a lint and not legal advice.
When in doubt, ship a patch or a converter that runs on the install of the user.
</lint>

<package>
Package the way that the platform expects.

| Platform or loader | Package |
| --- | --- |
| tModLoader | Build a `.tmod`, and publish it from the Mod Sources menu in the game (Steam Workshop) |
| BepInEx or Thunderstore | Zip with `manifest.json`, `icon.png` (256x256), `README.md`, and `plugins/<Mod>.dll` |
| Nexus Mods | Zip laid out as it installs (`Data/...` for Bethesda, `BepInEx/plugins/...`, `ue4ss/Mods/...`, or `~mods/*.pak`) |
| AoE2 DE | The official mod site or the uploader in the game, and data mods hold `resources/_common/dat/...` |
| Steam Workshop | The uploader or SDK tool of the game |
| Minecraft | A Modrinth or CurseForge jar with `fabric.mod.json` or `neoforge.mods.toml` |
| ROM hack or GameMaker | Patches only (BPS, IPS, or xdelta), never the changed game file |

- A Thunderstore dependency string looks like `BepInEx-BepInExPack-5.4.2100`.
  Check the current version of each dependency.
- A Nexus mod with options gets a FOMOD installer.
  See the [FOMOD tutorial](https://fomod-docs.readthedocs.io/en/latest/tutorial.html), the [STEP FOMOD guide](https://stepmodifications.org/wiki/Guide:FOMOD), and the [Nexus modding wiki](https://modding.wiki/en/home).
</package>

<readme>
Put a README in the package and on the page.
It has these parts:

- What the mod adds: bullets, and a GIF or the showcase video (`showcase-video`).
- Requirements: the game version, the loader and its version, and the dependencies.
- Install, uninstall, and troubleshooting, with the place of the log.
- Compatibility: multiplayer, and known conflicts.
- Credits:
  - the loader and the libraries,
  - the references that you learned from,
  - a line such as "Art and audio generated with fal (fal.ai) using <models>", with the models from `fal_manifest.jsonl`,
  - an honest AI disclosure that names the agent and the model.
- The license of the code (MIT and Apache are common).
  The terms of the assets follow the licenses of the models.
</readme>

<version>
Use semver in the manifest or build file, name the supported game version, and keep a changelog.
When the game updates, run the test scene in the game again before you bump the version.
</version>

<post>
- Lead with the video.
  It runs 20 to 45 seconds, and gameplay starts within 2 to 3 seconds.
- The text has the hook, what the mod is, how it was made (which agent and which fal models), and a link.
- Credit each creator whose footage is in the video, by handle, and ask them first.
- Write a draft and show it to the user.
  Do not post it.
</post>

<field_notes>
After the release, offer to write a field note with the `share-field-notes` skill.
`um kb pr` also needs the OK of the user.
</field_notes>
