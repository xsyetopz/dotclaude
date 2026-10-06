# Minecraft

## Java Edition: code mods with Fabric or NeoForge

- Fabric is a light loader plus Fabric API, with Mixin for bytecode patches.
  It updates fast to new versions.
  1. Get the template from <https://fabricmc.net/develop/template/>, or clone `FabricMC/fabric-example-mod`.
  1. Build with `./gradlew build`.
     The jar goes in `mods/`.
     `./gradlew runClient` starts a dev client with your mod.
     It is the best oracle for an agent, with logs in `run/logs/latest.log`.
- NeoForge is the successor of Forge for modern versions (MDK template).
  Its API is larger (capabilities and events).
- Forge (1.20.1, 47.x) is still the loader of many CurseForge instances.
  Use the MDK with official mappings and JDK 17.
  `./gradlew runServer` and `runClient` are the oracles.
  Put each self-test behind a Gradle property (for example `-Pselftest`), so it does nothing in a real world.
  Do not run two Gradle builds at the same time.
- Mappings: Mojang publishes official obfuscation maps.
  Loom (Fabric) handles Yarn or Mojang mappings and makes readable sources with `./gradlew genSources`.
- Content: register items, blocks, entities, and sounds through the registries.
  Assets go in `src/main/resources/assets/<modid>/` (16x16 PNG textures, JSON models, lang JSON, and `sounds.json` plus ogg files).
  Data (recipes, loot tables, tags) goes in `data/<modid>/`.
- Server side only: plugins (Paper or Spigot) plus resource packs change a lot without client mods.
  A "Black Ops 2 inside vanilla Minecraft" demo was a plugin plus a resource pack.
- `minecraft-modding-mcp` gives an agent mappings, decompiled source, and version diffs.

## Bedrock Edition: add-ons

Use behavior packs (JSON entities, items, and blocks, plus the Script API in JavaScript or TypeScript with `@minecraft/server`) and resource packs.
Develop in `com.mojang/development_*_packs` and turn on content-log output to see errors.

## Pitfalls

- Match the exact triple of game version, loader version, and API version.
  Mods are version-locked.
- Minecraft 26.3 facts (from the GTA passthrough project, see `um kb search "minecraft passthrough"`):
  - A depth readback (`copyTextureToBuffer`) leaves the read buffer at `GL_NONE`, so later colour readbacks fail.
    Restore it in a mixin.
  - The Fabric `JOIN` event fires before the player is in the player list.
    Delay setup commands by about 10 ticks.
  - The Invisible flag of an entity resets on the first sync unless the entity has an effect.
  - Mobs cannot target invulnerable entities.
  - With `noPhysics`, `onGround` sticks, so elytra glides are cancelled.
- Forge 1.20.1 facts (from the Bloons TD 6 mashup, see `um kb search "bloons"`):
  - Writing the TOML at run time with `ConfigValue.set()` and `save()` can truncate it.
    The file is written in place while the Forge watcher (night-config 3.6.4) reads it again.
    Keep the live value in memory, write a sibling temp file, then rename it over the original.
  - That watcher misses many editor saves (it ignores aggregated modify events).
    Poll the mtime.
  - Forge does not rewrite a value that is already in the TOML, so a changed default does not reach existing users.
    Write floats as `1.0`, not `1`.
  - Buckets bypass `EntityPlaceEvent` (Forge does not capture their placement).
    To control fluids, listen to `NeighborNotifyEvent` and act in the same tick.
  - Any `MOVEMENT_SPEED` modifier widens the FOV.
    Undo only your own term in `ComputeFovModifierEvent`.
  - Chunks rebuilt on the server can stay invisible until the camera changes section (the client caches its visible-section graph).
    Call `LevelRenderer.needsUpdate()` a few seconds later.
  - Minecraft attenuates and positions only mono sounds.
    Convert stereo sources to mono.
  - Dev runs use Mojang names, and the shipped jar uses SRG names.
    Code that matches methods by name passes the benches and fails in the real game.
    Ask the user to run the real jar in the real instance.
  - Give the network channel an explicit protocol version.
    Then a client with another jar is refused at login and does not crash in the middle of the game.
- A separate launcher profile keeps the worlds of the user safe.
  Add a Fabric profile with its own `gameDir`.
  `fabric-installer -launcher microsoft_store` fails because `launcher_profiles_microsoft_store.json` is missing.
  Edit `launcher_profiles.json` by hand, after a backup.
- Multiplayer: a server needs the mod too, or use plugins.
  Do not ship client hacks for public servers.
- Mashups: the September 2026 "Minecraft inside X" projects either reimplemented Minecraft (Rust rewrites that match Java worldgen) or ran it side by side and exchanged state (passthrough).
  They downloaded the Minecraft assets from Mojang at first run and did not redistribute them.
