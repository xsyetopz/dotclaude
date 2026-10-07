# fal assets

<task>
Make the assets that a mod needs and that do not exist yet.
Examples are a weapon sprite, a boss, a tileable floor, a laser sound, and a voice line.
fal runs many generative models behind one key.
After the generation, use `asset-pipeline.md` to make the files fit the engine.
</task>

<setup>
Check this one time for each session.

- Key: `um fal` reads the plugin option `fal_key`, or else the `FAL_KEY` environment variable.
  The user creates a key at <https://fal.ai/dashboard/keys>.
  Never write the key in a mod file, because `um publish check` fails on a leaked key.
- MCP: the plugin has a `fal` MCP server.
  It uses the same `fal_key` option.
  Its tools search models, read schemas and prices, run models, submit jobs, upload files, and search the fal docs.
  Look at the tools that your session lists, because the names can change.
- No key: for images only, `um comfy` uses a local ComfyUI server.
  Run `um comfy status`, and then `um comfy image "<prompt>" --sprite`.
  It has no audio, 3D, or video.
</setup>

<which_interface>

- Discovery (the best model for a task, its inputs, its price): `um fal search "<query>"`, `um fal schema <endpoint>`, `um fal price <endpoint>`, or the fal MCP tools.
  The catalog changes fast.
  The defaults below were checked in September 2026, so check them again before a big batch.
- Each asset that must be a file: `um fal <recipe>`.
  It uploads local inputs, waits for the job, downloads each output, and adds the endpoint, inputs, seed, and request id to `<out>/fal_manifest.jsonl`.
  With this line, you can trace an asset and make it again.
- A quick look where a URL is enough: the MCP tool that runs a model.
</which_interface>

<recipes>
`--model` changes the endpoint.
`--set k=v` passes extra inputs.
`--out` and `--name` set the folder and the file name.
Each recipe has `--help`.

| Asset | Command | Default model |
| --- | --- | --- |
| Sprite or icon, transparent | `um fal sprite "<subject, view, style>" --name x` | GPT Image 2 |
| Concept art, key art, background | `um fal image "<prompt>" --aspect 16:9` | Nano Banana 2 |
| Variant, extra frame, recolor, new pose | `um fal edit "<change>" --ref base.png` | Nano Banana 2 edit |
| Remove the background | `um fal rmbg in.png` | BiRefNet v2 |
| Pixel art from an image | `um fal pixelate in.png --colors 24` | image2pixel |
| Upscale | `um fal upscale in.png --factor 2` | SeedVR2 |
| Seamless texture | `um fal texture "mossy cobblestone"` | Z-Image Turbo tiling |
| PBR maps | `um fal pbr "rusted sheet metal"` | PATINA |
| Image to 3D model (GLB) | `um fal model3d concept.png` | Trellis 2 |
| Auto-rig a humanoid | `um fal rig character.glb --animate` | Meshy |
| Sound effect | `um fal sfx "plasma rifle shot, punchy" --seconds 1.2` | ElevenLabs SFX v2 |
| Music | `um fal music "tense boss battle, chiptune, 150 bpm" --seconds 90` | ElevenLabs Music |
| Voice line | `um fal voice "You dare challenge me?" --voice-id Adam` | ElevenLabs v3 |
| Trailer or cutscene clip | `um fal video still.png "camera orbits the boss"` | Seedance 2.5 |
| Any other endpoint | `um fal run <endpoint> key=value key:=json image_url=@local.png` | any |

- `um fal model3d --engine` takes `trellis2`, `hunyuan`, `tripo`, or `meshy`.
- `um fal sprite --quality` takes `low`, `medium`, or `high`.
  `um fal image --res` takes `0.5K`, `1K`, `2K`, or `4K`.
- `um fal sfx --loop` asks for a loop.
  `um fal music --vocals` adds vocals.
- `um fal search` finds other endpoints, such as remesh, retexture, text to motion, vector icons, and video background removal.
  Read `um fal schema <endpoint>` before the first call.
</recipes>

<prompting>
- Look at the assets of the game first: pixel size, outline, palette, perspective, facing, and how busy they are.
  Put this in a style suffix that you reuse.
  Example for Terraria: "16-bit pixel art game sprite in the style of Terraria, crisp dark outline, limited palette, centered, plain flat white background, no shadow, no text".
- Describe the view and the facing in words.
  Examples are "perfectly horizontal side view with the muzzle pointing right" and "seen from the side facing left".
  Engines have conventions, and a fix of the facing after the generation costs quality.
- Ask for a transparent background, or a flat colour that `um sprite cutout` can fill.
  Avoid gradients, scenery, and ground shadows.
- For a player colour, ask for "bright saturated blue accents" on the parts that take the colour.
  Then `um sprite team-mask --hue blue` makes the mask.
- For a consistent set, generate one hero image.
  Then derive the others with `um fal edit` and the hero as `--ref`, for example "same robot, now firing, muzzle flash".
  Do not ask one prompt for a whole sprite sheet, because the grid comes out uneven.
- For many angles or frames of one object, use 3D.
  Run `um fal model3d`, and then `um render3d` with the camera of the game (see `asset-pipeline`).
- Ask for no text or logos, because models add them.
</prompting>

<audio>
SFX and music come back as MP3.
Convert them to the format of the engine:

- WAV for XNA, tModLoader, and most engines: `ffmpeg -i x.mp3 -ar 44100 x.wav`
- OGG for Minecraft, Godot, and Unity: `ffmpeg -i x.mp3 -c:a libvorbis -q:a 5 x.ogg`
- Trim the leading silence first with `-af silenceremove=start_periods=1:start_threshold=-50dB`.

For a loop, use `um fal sfx --loop`, or ask the music model for a loopable track and crossfade the ends.
Keep SFX short (0.2 to 2 s).
Normalize the loudness with `-af loudnorm=I=-16`, so that the SFX match the sounds of the game.
</audio>

<cost>
- Check the price with `um fal price <endpoint>` before a batch of 3D, video, or long music.
  Tell the user the rough cost first when you plan more than about 20 generations or any video.
- Explore cheap with `--quality low` or `--res 0.5K`.
  Then run the best ones again at full quality with the same prompt, and the same `--seed` where the recipe has it.
- Keep `fal_manifest.jsonl` with the assets.
- In the README of the mod, credit the fal models.
  Check the license page of each model for commercial use.
  `um publish check` warns when a `fal_manifest.jsonl` has no attribution line.
</cost>
