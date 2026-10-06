---
name: game-automation
description: Launches, sees, and drives a real game, so that an agent can test its own mods. Covers launch through Steam or the exe, windowed mode at a fixed size, window screenshots, clicks, keys, mouse input, crash-reporter cleanup, stopping by PID, logs, scripted test scenes, and an in-game JSON bridge. Windows first (also from WSL), with notes for Linux and macOS. Use when a mod must be verified in the game, when menus need automatic navigation, or when a repeatable test or demo scene is needed.
allowed-tools: Bash(um win ps*) Bash(um win shot *) Bash(um scan *) Bash(um backup create *) Bash(um backup list*) Bash(um backup diff *) Bash(um kb search *) Bash(um kb show *)
---

<task>
The real game is the oracle.
The loop is launch, navigate, set up the scene, act, screenshot and read the logs, then decide.
Build the loop once for each game.
After that, you can check each change in a minute.
</task>

<windows>
## Windows (native or from WSL): `um win`

```bash
um win setup                       # once: PowerShell tools and an ffmpeg with gfxcapture
um win ps                          # processes that have a window
um win launch --steam 105600       # or: um win launch "C:\Games\Foo\Foo.exe" -- -windowed
um win shot --exe Terraria.exe shot.png --scale 0.33
um win drive --proc Terraria "focus" "click 640 360" "key 0x1B" "type hello" "hold 0x44 1500"
um win drive --proc Terraria idle  # seconds since the user last touched the mouse or keyboard
um win kill <pid>                  # exact PID only
um win reg get "HKCU\Software\..." # registry (reg set backs up the key first)
```

`um win shot` has the options `--exe NAME`, `--hwnd N`, `--title RE`, and `--scale F`.
`um win ps [name]` lists the windowed processes.
`um win record --out BASE` records a window and its audio (see the `showcase-video` skill).

### WinDrive commands

`um win drive --proc NAME <command>...` sends these commands to the game window.
Coordinates are in the client area of the game window.

- Mouse:
  - `move x y`
  - `click x y [right]`
  - `mdown x y [right]` and `mup [right]`
  - `drag x0 y0 x1 y1`
  - `rel dx dy` (FPS cameras and raw input)
  - `wheel 120` (120 is one notch up)
- Keyboard:
  - `key <vk> [tap|down|up]`
  - `hold <vk> <ms>`
  - `type <text>`
  - `scanmode on|off` (sends hardware scan codes, for DirectInput and raw-input games that ignore virtual-key events)
- Window:
  - `focus`
  - `rect` (the client area in screen coordinates)
  - `size <w> <h>` (sets the client size)
  - `title`
  - `fg` (the name of the foreground process)
  - `idle`
  - `untop`
- Virtual-key codes: Esc 0x1B, Enter 0x0D, Space 0x20, W, A, S, D 0x57, 0x41, 0x53, 0x44, F1 0x70, Shift 0x10, Ctrl 0x11, and arrows 0x25 to 0x28.

### Rules of the road

- Do not focus a game that has an online mode while the user types.
  This happened with GTA V.
  The agent focused GTA to click Story Mode, and the keystrokes of the user hit the landing page of GTA.
  GTA warned about "accessing GTA Online servers with an altered version".
  ScriptHookV blocked it, but do not rely on that.
  Check `idle`, ask the user to click, and launch with the anti-cheat off, so that online play cannot start.
  Run `um kb search "driving real games safely"` for the field note.
- Input goes only to the game.
  WinDrive does not send input while another app is in the foreground.
  There is one exception.
  When no window is in the foreground and the cursor is over the game, WinDrive sends the input.
  Windowed games cause this when they drop the foreground on clicks.
- The user may be at the PC.
  If `idle` shows less than a minute, ask before you drive, and keep sessions short.
  Unattended runs are fine after the user says so.
- Screenshots cost tokens.
  Look at the `--scale 0.33` copies.
  Multiply the coordinates by 3 for clicks.
  Measure the menu click points once and keep them in a table in `MODLOG.md`.
- gfxcapture (Windows.Graphics.Capture) grabs the real frames of one window, even when another window covers it.
  GPU-rendered games come out black with GDI capture.
  gfxcapture cannot capture minimized windows.
- HDR displays: if Windows Auto HDR is on for an SDR game, captures can come out washed out and shifted in colour, so you cannot judge colours.
  Turn Auto HDR off for the game while you capture (Settings, System, Display, Graphics, the game, Auto HDR).
  Turn it on again afterwards if the user wants it.
</windows>

<predictable_window>

## Make the window predictable

- Use windowed mode at a fixed client size.
  Each game hides this setting somewhere:
  - An ini file.
    Unreal uses `[/Script/Engine.GameUserSettings]` in `GameUserSettings.ini`.
    Unity keeps `Screenmanager Fullscreen mode` and `Resolution` registry values under `HKCU\Software\<company>\<product>`.
  - A launch flag.
    Examples are `-windowed -w 1920 -h 1080`, Unity `-screen-fullscreen 0 -screen-width 1920 -screen-height 1080`, and Source `-sw -w 1920 -h 1080`.
  - The registry of the game itself.
    AoE2 uses `Mode Display` 0 plus `Windowed Width` and `Windowed Height`.
  - `um win drive --proc <name> "size 1920 1080"` resizes most windowed games.
- Skip intros with launch flags (`-skipintro`, `-nosplash`, Unity `-popupwindow`).
  Or delete or rename the intro videos in a copy of the game.
- Jump straight in with a loader flag (tModLoader `-skipselect Player:World`), a save made for testing, a scenario that loads automatically, or a dev console command.
- Background throttling: many games slow down or pause when they are not focused.
  Find the setting:
  - Terraria: `Main.instance.InactiveSleepTime = TimeSpan.Zero`
  - Unity: `Application.runInBackground = true`
  - Unreal: `t.IdleWhenNotForeground 0`
</predictable_window>

<scripted_scene>

## Better than clicking: a scripted scene or a bridge

- Chat or console commands in your mod give items, spawn enemies, and teleport.
  They make a test one line (`/arsenal`, `/mothership`).
- Test scenes:
  - a timeline in the mod (spawn waves at frame N, fire at frame N+30)
  - a scenario with triggers (AoE2, with AoE2ScenarioParser)
  - a dedicated test world with a pristine backup
- Agent bridge: a JSON-lines socket inside the mod, on `127.0.0.1`.
  - Commands such as `observe` (menu options or world state as text), `click <id>`, `controls`, and `step`.
  - Handle each request on the main thread of the game after an update, so replies are consistent.
  - Read menus from the UI tree in a generic way, so the agent sees what a player sees.
    Leave out destructive buttons such as delete.
  - An agent can then play without pixels.
- Out-of-process backend: keep the in-game part small and put the logic outside, with HTTP or a file drop.
  This pattern scales to AI NPCs and cross-game mashups.
</scripted_scene>

<cleanup>
## Crashes and cleanup

- Crash reporters can stay alive and make Steam say "already running".
  Examples are BugSplat `BsSndRpt64.exe`, `CrashReportClient.exe`, and `UnityCrashHandler64.exe`.
  Run `um win ps` to find them, then `um win kill <pid>` for each one.
- Stop each process by its exact PID.
  A hook denies kill by name (`pkill`, `killall`, `taskkill /IM`, and `Stop-Process -Name`).
  A name pattern can match your own shell or other apps.
- After a crash, read the log of the loader or game first.
  The `mod-any-game` skill lists the logs.
  For native crashes, read the Windows Event Viewer (Application log) next.
</cleanup>

<other_platforms>

## Linux and macOS

`um win` is for Windows and WSL.
These notes use native tools.

- Linux (X11):
  - `xdotool search --name "Game" windowactivate --sync key Escape`
  - `xdotool mousemove --window $W 640 360 click 1`
  - Screenshots: `import -window $(xdotool search --name Game) shot.png`, or ffmpeg `x11grab`.
- Linux (Wayland): use `ydotool` and `grim`.
  Proton games are Windows games under Wine.
  Set launch options such as `WINEDLLOVERRIDES` and `PROTON_LOG=1` in Steam.
- macOS: `screencapture -l <windowid> shot.png` (get the window id with `GetWindowID` or AppleScript).
  Use `osascript` or `cliclick` for input.
  Input and screen recording need the Accessibility and Screen Recording permissions for the terminal.
</other_platforms>
