---
name: showcase-video
description: Records a game window with only the audio of the game, picks moments from contact sheets, and cuts a short showcase video of a mod, or a compilation of clips, with one-line titles, credits, transitions, music, a watermark, and a fade-out. Use when the user wants a demo video, trailer, clip, or montage of a mod, or wants to combine existing clips into a styled video.
allowed-tools: Bash(um video *) Bash(um win ps*) Bash(um win shot *) Bash(um backup create *) Bash(um backup list*) Bash(um backup diff *)
---

<task>
Show a mod in 30 seconds.
The tools are `um win record` (capture), `um video contact` (look), and `um video compile` (edit).
Capture runs on Windows and WSL.
Editing uses `ffmpeg` and Pillow.
</task>

<take>
Make the take repeatable, so that you can shoot it again after a fix.

- Script the action: a timeline or command sequence in the mod (spawn enemies, fire the weapon, start the boss), a scenario with triggers and camera moves, or a list of `um win drive` commands.
- Restore the world before each take, because explosions crater worlds and units die.
  Keep a clean copy with `um backup create`, and restore it with `um backup restore`.
- Clean the frame: hide debug text, fix the camera zoom, and hide the cursor.
  Run the game at full speed when it is not in focus.
</take>

<record>
```bash
um win record --exe Game.exe --out C:\caps\take1 --seconds 40
um video first-frame C:/caps/take1.mkv
um video mux C:/caps/take1.mkv C:/caps/take1.audio.raw C:/caps/take1.json take1.mp4
```

- `um win record` writes `take1.mkv`, `take1.audio.raw`, and `take1.json`.
  It records only the window of the game, and the audio of the game.
  `--crop L:T:R:B` crops the frame.
  For a 32:9 screen, crop to the centre 16:9.
  `--no-audio` and `--fps` are also options.
- `um video first-frame` prints the seconds until the first gameplay frame, and skips loading screens.
- `um video mux` joins the files into an mp4.
  If the audio is out of sync, find a visible and audible event (a flash and its boom), and pass `--offset <seconds>`.
- Write `.mkv` for a recording that you stop from a mod.
  A killed recorder still leaves a playable file.
- Do not stop a process by name.
  A hook denies `pkill`, `killall`, `taskkill /IM`, and `Stop-Process -Name`.
  Find the PID with `um win ps`, and stop the process with `um win kill <pid>`.
  See `game-automation` for the other `um win` commands.
- Run the first capture with a short `--seconds`, and check the result with `um video probe`.
</record>

<look>
```bash
um video probe clip.mp4
um video contact clip.mp4 sheet.png --every 1.5 --cols 6
um video contact clip.mp4 zoom.png --start 20 --end 30 --every 0.5
```

`contact` makes a grid of frames with timestamps.
Open the image and read it.
Pick the peak moments, such as the explosion, the boss reveal, or the unit in formation.
Write the in and out times in the EDL.
</look>

<edit>
`um video compile edl.json out.mp4` renders the EDL.
`--preview` renders at half size and fast.
`--keep` keeps the work folder.
Paths in the EDL are relative to the folder of the EDL file.
`um video --help` has the full format.

```json
{
  "size": [1920, 1080], "fps": 30,
  "theme": {"accent": "#B6FF3B"},
  "transition": {"type": "fade", "duration": 0.3},
  "clip_volume": 0.8,
  "music": {"path": "music.mp3", "volume": 0.5},
  "watermark": {"path": "logo.png", "height": 54, "corner": "br"},
  "segments": [
    {"clip": "take1.mp4", "in": 9.0, "dur": 3.0,
     "hook": "Terraria, but with a tactical nuke."},
    {"clip": "take1.mp4", "in": 24.2, "dur": 4.5, "title": "Tactical Nuke",
     "transition": {"type": "pixelize"}},
    {"clip": "take2.mp4", "in": 3.0, "dur": 5.0, "title": "Drone Mothership boss"},
    {"card": {"title": "Fal Arsenal", "sub": "a Terraria mod"}, "dur": 2.5}
  ]
}
```

- Transitions: any ffmpeg `xfade` type, such as `fade`, `pixelize`, `slideleft`, `circleopen`, or `zoomin`, or `cut`.
- Fill: for a clip that is not 16:9, set `"fill"` to `blur`, `crop`, or `pad`.
- Per clip: `speed`, `volume`, `zoom` (to punch in past the UI), and `crop` as `[x, y, w, h]`.
- Music: `um fal music "..." --seconds 60` makes a bed (see `fal-assets`).
  Set `bpm` and use `beats` in place of `dur` to cut on the beat.
  `um video beats music.mp3` estimates the tempo and the first beat.
</edit>

<style>
- Titles: one line that names what is on screen.
  Explanations of how it was made go in the text of the post.
- Pace: gameplay starts within 2 to 3 seconds.
  Menus and setup stay under 3 seconds.
  Each clip runs 3 to 5 seconds.
  End on the name of the mod or a URL, and fade out.
- Sound: keep the audio of the game, because it sells the impacts.
  Under a compilation, put music, and set the clip volume to about 0.5 to 0.8.
- Footage of other people: credit each creator on screen (`"credit": "@handle"`) and in the post.
  Ask permission when the video is promotional.
  Do not say that their clips came from your tool.
  Download only public posts, and only what you use.
- Last step: make a contact sheet of the finished video and look at it before you share it.
  The post is a publish, so follow `publish-mod` and get the OK of the user.
</style>
