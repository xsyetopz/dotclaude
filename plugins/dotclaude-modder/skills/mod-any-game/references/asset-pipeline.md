# Asset pipeline

<task>
Turn art into files that the game accepts: the right size, frame layout, facing, alpha, palette, and format.
`fal-assets.md` makes the pictures.
This file makes them fit.
The commands are `um sprite`, `um render3d`, and `um win shot`.
</task>

<target_format>
Learn the target format from the game before you convert anything.
Open two or three assets of the game, and write this in `MODLOG.md`:

- Dimensions: frame size, frames per sheet, and layout (strip, grid, or one file per frame).
- Facing: the direction that the art faces, and the pivot or hotspot.
  In Terraria, items point right and NPCs face left.
  In AoE2, the ground point of a unit is at the centre of the canvas.
- Alpha: hard 1-bit edges (pixel art, BC1 punch-through) or soft edges.
- Style: palette size and outline.
- Format: PNG, DDS, XNB, SLD, or an atlas with JSON.

The draw code of the engine has the final say.
In Terraria, the NPC frame height is the texture height divided by `Main.npcFrameCount`, so any consistent frame size works.
</target_format>

<pipeline_2d>
Each command has `--help`.

```bash
um sprite info raw.png
um sprite cutout raw.png cut.png
um sprite cutout raw.png cut.png --grey 150 --keep-top 0.8
um sprite fit cut.png item.png --size 64x26 --hard-alpha
um sprite fit cut.png npc.png --size 38x34 --anchor bottom
um sprite pixelate cut.png px.png --size 32x32 --colors 16 --outline
um sprite palette px.png px2.png --from stock_sprite.png
um sprite frames npc.png frames/ --n 3 --kind bob
um sprite sheet sheet.png frames/*.png --vertical
um sprite slice sheet.png out/ --frame 32x32
um sprite team-mask unit.png unit_grey.png --hue blue
um sprite preview item.png look.png --scale 6
```

- `cutout` fills from the border, so it keeps white areas inside the sprite, such as eyes.
  `--grey` and `--keep-top` remove a soft shadow and the floor under it.
- `fit` trims the sprite, then scales it one time to the frame.
  Pixel art uses nearest neighbour.
  Scaling pixel art two times blurs it.
  For painted or HD art, add `--smooth`.
- `--anchor bottom` puts a standing sprite on the bottom edge of the frame.
- `frames --kind` accepts `bob`, `squash`, `wobble`, and `flash`.
- For real animation frames, generate each frame with `um fal edit` and the base sprite as `--ref`.
  Then cut out and fit each frame with the same commands.
  Or use the 3D route below.
- Open the `preview` image and look at it before you ship it.
</pipeline_2d>

<pipeline_3d>
A 3D render keeps every facing and frame consistent.
Image generation per frame cannot do this.
Blender must be on `PATH`, or `BLENDER` must hold its path.

```bash
um fal model3d concept.png --name unit
um render3d assets/gen/unit.glb frames/ --preset aoe2 --length 80 --forward-yaw -90 \
  --anims idle:10:bob,walk:12:walk,attack:16:lunge,death:20:die --shadows --samples 40
um render3d assets/gen/unit.glb side/ --preset side --canvas 128 --length 110 --engine eevee
```

| Preset | Camera | Headings |
| --- | --- | --- |
| `aoe2` | ortho 30 deg | 16, clockwise from east |
| `iso8` | ortho 30 deg | 8 |
| `trueiso` | ortho 35.264 deg | 8 |
| `topdown` | ortho 90 deg | 8 |
| `side` | ortho 0 deg | 2 (right, left) |
| `turntable` | perspective 20 deg | 24 (icons, promo spins) |

- `--length` sets the longest horizontal side of the model in pixels at 1x.
  Match the stock units of the game.
- `--forward-yaw` turns the model, so its nose faces +X.
  Check the first frame.
- `--shadows` adds a shadow pass, `*_s.png`, for engines that keep shadows in their own layer.
- The frames are `<out>/<anim>_<heading>_<frame>.png`.
- The motion names in the `--anims` code are `bob`, `walk`, `lunge`, `die`, `wreck`, `spin`, and `still`.
- If the textures look dark, raise `--sun` or `--ambient`, or brighten the frames after the render.
- Pack the frames with `um sprite sheet`, or with a writer for the engine.

For game-ready 3D that is not a sprite, remesh the model with `um fal run`.
Use `um fal search "remesh"` and `um fal schema <endpoint>` to find the current endpoint and its inputs.
Then convert the file in Blender with the scale and axis rules of the engine.
Unity is Y-up in metres, and Unreal is Z-up in centimetres.
</pipeline_3d>

<textures>
- Tiling: `um fal texture` makes a tiling texture.
  Check it with `um sprite tile-preview t.png t3.png`.
  Make other images tile with `um sprite seamless`.
- PBR: `um fal pbr` makes the maps.
  Pack them for the engine, such as Unreal ORM (occlusion, roughness, metalness in RGB), or Unity metallic-smoothness (smoothness is 1 minus roughness, in alpha).
- DDS: use `texconv` (DirectXTex) or ImageMagick.
  BC7 gives the best quality, BC1 suits cut-out sprites, and BC3 suits soft alpha.
  The `um` command has no DDS writer.
</textures>

<verify>
Put one converted asset in the game, and take a screenshot next to the stock art with `um win shot`.
Check scale, facing, pivot, outline, and palette.
Fix the recipe, then convert the rest with the same commands in one script, so that `assets/gen/` can rebuild the pipeline.
`game-automation.md` explains screenshots and input.
</verify>

<guest_game_assets>
For a mashup, you can convert the Unity assets of a guest game from the install of the user.
The read steps and the pitfalls are in `unity-assets.md` next to this file.
Write the output only to a local, private resource pack.
Never put it in the mod, in its repository, or in a release.
</guest_game_assets>
