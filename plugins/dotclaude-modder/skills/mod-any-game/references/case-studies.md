# Case studies

Three projects shaped this method.
They are a Terraria mod, a new Age of Empires II civilization, and Minecraft inside GTA V.
Each section gives the route, the pipeline, and the facts that took time to find.

## Terraria: homing missiles, a tactical nuke, new enemies, a boss

Route: loader API (tModLoader).
Terraria is a .NET (XNA or FNA) game, and tModLoader is the official community loader.
It is a free Steam app with id 1281930.
Content is C# subclasses: `ModItem`, `ModProjectile`, `ModNPC`, `ModSystem`, `ModPlayer`, and `ModCommand`.

Pipeline:

1. Recon: `um scan terraria` reports XNA or FNA .NET, no anti-cheat, and the route tModLoader.
1. Source of truth: decompile `Terraria.exe` with `ilspycmd` into `~/terraria-decomp`, outside git.
   Read the vanilla AI there, for example `NPC.AI_004` for the Eye of Cthulhu and the `aiStyle` numbers.
   The decompiled base of tModLoader 1.4.4.9 was diffed against vanilla 1.4.5.8.
   The only differences were refactors.
1. Lab: tModLoader started with `-tmlsavedirectory C:\dev\tModLoader\lab`, so the real characters and worlds stay untouched.
   Code creates a lab character if none exists.
   `-skipselect Char:World` goes straight into a world.
1. Content: weapons as `ModItem` plus `ModProjectile`, and enemies as `ModNPC` with a custom `AI()`.
   The boss has two phases, a boss bar, music, and loot.
   A scripted showcase `ModSystem` spawns waves and moves the camera.
1. Art: fal `flux/dev` with a Terraria-style prompt ("16-bit pixel art game sprite in the style of Terraria, crisp dark outline, limited palette, plain flat white background").
   Then a border flood-fill cutout, then a nearest-neighbour fit to each frame size.
   The tools are `um sprite cutout`, `um sprite fit`, and `um sprite sheet --vertical`.
1. Verify: `client.log` of the game, screenshots of the window, and a deterministic scripted scene.
1. Showcase: recorded from inside the mod with ffmpeg gfxcapture of its own window and process-loopback audio.
   The parts were muxed with QPC timestamps and cut to about 30 seconds.

Facts that took time:

- The NPC frame height is the texture height divided by `Main.npcFrameCount`, so any consistent frame size works.
  Vertical strips are the convention.
- Sprite orientation:
  - Items point right.
  - NPC sprites face left, and the engine flips them.
  - A projectile with rotation 0 points right, unless you draw it yourself in `PreDraw`.
- The vanilla fighter AI (`aiStyle` 3) flees in daylight.
  A walker enemy for daytime needed custom AI.
- `Main.instance.InactiveSleepTime = TimeSpan.Zero` keeps full speed when the window is not focused.
  This matters for automated takes.
- Do not read the back buffer from inside the game for recording.
  `ReadBackbuffer` of FNA3D with D3D11 leaked a full-size staging texture on each call, 17 GB in one take.
  Capture the window from outside with ffmpeg `gfxcapture=hwnd=...`.
- FAudio talks to WASAPI directly, so `SDL_AUDIODRIVER` settings do nothing.
  Use process-loopback capture of the PID of the game.
- Do not block the main thread of the game while ffmpeg stops.
  gfxcapture stalls on a frozen window and does not read the `q`.
  Send `q`, then wait off-thread.
- Write `.mkv` while you record.
  It survives a kill, and an mp4 loses its index.
- Explosive takes make craters in the showcase world.
  Restore the pristine copy before each take with `um backup restore`.
- tModLoader refuses to start unless the free tModLoader app is in the Steam library.
  Install it.
  Do not patch the check.
- A float-exact port of game logic (for a simulator) must use float32 constants.
  `0.2f` is not `0.2`.
- Stop processes by exact PID.
  A name pattern kills the command line of the agent.

## Age of Empires II DE: the San Franciscans civilization

Route: data mod plus graphics.
AoE2 DE is the Genie engine.
Its game data is one large `.dat` file (`resources/_common/dat/empires2_x2_p1.dat`), which `genieutils-py` reads and writes.
Local mods go in `%USERPROFILE%\Games\Age of Empires 2 DE\<steamid>\mods\local\<Mod>`.

Pipeline:

1. Recon: `um scan "age of empires"` reports Genie and no anti-cheat.
   Ranked play uses unmodded data anyway.
1. Data: clone the tech tree of the Britons into the new civ.
   Add unique units by deep-copying a template unit, then change stats, graphics, and train location.
   Add unique techs with effects, bonuses, key-value strings, and a tech tree JSON.
1. Units:
   - fal concept art (a white product render with saturated blue accents where the player colour goes)
   - fal Trellis image-to-3D into a GLB
   - Blender renders from the AoE2 camera: orthographic, 30 degrees elevation, 16 headings clockwise from east, plus a shadow-catcher pass (`um render3d <model.glb> <outdir> --preset aoe2 --shadows`)
   - blue accents hue-masked into the player-colour layer (`um sprite team-mask`)
   - packed into `.sld` sprites
1. SLD format: reverse engineered from the game files.
   Layers are BC1 main, BC4 shadow, BC1 damage mask, and BC4 player colour.
   Frames are 4x4 blocks with skip and draw commands.
   A round trip of the stock knight (decode, encode, decode, compare) gave 0.9 of 255 mean error.
1. Demo: a scenario built with AoE2ScenarioParser (units, triggers, camera).
   WinDrive drove the game through the lobby.
   The recording used gfxcapture plus process-loopback audio, cut with one-line titles.

Facts that took time:

- A mod with a `.dat` is a data mod.
  It applies only when chosen in the "Data Mod" dropdown of the skirmish lobby.
  The Mod Manager shows local mods with a gear icon, not a checkbox.
- The civ picker lists only the civs that the executable knows.
  The civ-id table ends at the last official civ, and the UI icon tables are index-based.
  A new civ must replace a slot (the Burgundians, 36).
  Extra civs load and play, but they do not show in the picker.
- DE key-value strings keep the DLL help strings at `id - 79000`.
  Example: Knight help `105068` is key `26068`.
- Icons of the command panel come from the prebuilt `widgetui` atlas of the base game, and a local mod cannot extend it.
  Use stock icons in the game and your art in the menus, the civ picker, and the tech tree.
- Tech 266 "Castle built" does not fire for castles that a scenario places.
  Castle unique units need `creatable_type` 2.
- NVENC H.264 is limited to 4096 pixels wide.
  For a 5120x1440 screen, capture the centre 2560x1440 or use HEVC.
- Registry key `HKCU\Software\Microsoft\Microsoft Games\Age of Empires II DE`:
  - `Mode Display` 0 is windowed and 1 is full screen.
  - `Windowed Width` and `Windowed Height` accept any size.
    This avoids the in-game list that stops at 1366x768.
    A size of 1936x1119 gives a 1920x1080 client area.
- A windowed game can drop the foreground on clicks.
  WinDrive treats "nothing in the foreground and the cursor over the game" as safe.
- A crash leaves the BugSplat process `BsSndRpt64.exe` running, and Steam then refuses to start the game ("already running").
  Find the PID with `um win ps`, stop it with `um win kill <pid>`, and relaunch.

## Minecraft inside GTA V: a passthrough mashup

Route: passthrough.
Real Minecraft Java 26.3 (a Fabric mod) runs next to GTA V story mode (a ScriptHookV ASI plus a ReShade add-on).
They exchange camera, ground, input, and events over a local WebSocket.
Minecraft sends its colour and depth frames over shared memory.
The depth-tested composite happens in the frame of GTA.

Facts that took time:

- Minecraft 26.3 GL backend: it leaves the read buffer at `GL_NONE` after a depth readback.
  Colour readbacks fail until you restore it.
- ReShade must load through the ASI loader of GTA, because the system `dxgi.dll` wins over a proxy.
- Blocks are one frame ahead.
  The script reads the camera for the frame that is in preparation, so re-project Minecraft to the previous pose.
- Time both sides with the same high-resolution clock (Java `nanoTime` is QPC).
  `GetTickCount` judders.
- Guns of the host game on a guest avatar looked wrong.
  Guest weapons with host-game effects worked (arrows became GTA bullets, fireworks became GTA explosions).
- Do not focus the landing page of GTA while the user types.
  Keystrokes there nearly started GTA Online with a modified game.
  ScriptHookV blocked it, but do not rely on that.

## What the 2026 AI mashup wave added

Projects in September 2026 include skateboarding in MW2, Minecraft inside Skyrim, Elden Ring, and Mario 64, and Black Ops 2 inside Minecraft.
Another is a Majora's Mask recomp that Opus extended.
The `mashup-mods` skill covers them.

- The largest ones are reimplementations, not injection hacks.
  - IW4L is a Rust MW2 runtime that reads the MW2 files of the user.
  - The Skate 3 Rust engine used a static recomp as its oracle.
  - Minecraft comes from a Rust rewrite.

  The fusion then happens in one process.
  No file of the original games is committed.
- Passthrough mods run both games at once, with a mod in each that talks over local IPC.
  The geometry of the guest goes into the renderer of the host.
  Collisions go back to the guest.
- Long agent runs survive through:
  - hard oracles, such as scripted game runs with screenshots and dumps, byte matching, and build-and-verify scripts
  - an on-disk journal
  - bounded attempts (circuit breakers)
  - a human for playtesting
