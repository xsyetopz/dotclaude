# Convert the Unity assets of a guest game

Use this when a mashup needs the art, models, or audio of a Unity game.
Read the install of the user with UnityPy.
Write a local, private resource pack.
Each user runs the converter on their own copy, so the mod ships no guest assets.
`um publish check --game <install>` helps to catch a copied file.

## Memory

`UnityPy.load()` decompresses a whole bundle.
One bundle of 865 MB used 8.7 GB of RAM.
Decompress only the serialized files, and read `.resS` and `.resource` lazily, block by block.
Run each converter module in its own process.

## Environment

Use `UnityPy.Environment(path="")`, and load bundles that refer to each other together.
Otherwise UnityPy searches the working directory for the missing dependencies.

## Find the assets

- Addressables bundle names change at each update, so find them by prefix.
- Addressables 2.x has a binary `catalog.bin`.
- Map game objects to prefabs with their GUID keys.
  Do not guess from names.
- Use the low-quality variant when one exists.
  It has the same meshes and smaller textures.

## Meshes

- Skinned meshes are in bind pose, often a T-pose.
  For the look in the game, evaluate the idle clip at t = 0, rebuild the world matrices, and then skin.
  UnityPy reads `AnimationClip` objects but does not sample them.
  Generic clips bind Transforms by the CRC32 of the path.
- Walk the hierarchy from the container root.
  Skip inactive GameObjects and their children.
  Drop helper meshes such as eyelids, ground shadows, and stencil or outline materials.
- Unity is left-handed, and Minecraft is right-handed.
  Flip one axis for positions and normals, reverse the winding, flip V, and clamp the UVs.
  Check with a named bone: the right hand must end on the right.
- For a shared atlas, crop the texture of each part to its UV bounding box, and remap the UVs.

## Audio

`AudioClip.samples` needs FMOD (`fmod_toolkit`).
Encode with `ffmpeg` to mono OGG.

## Minecraft target

- A resource pack needs `pack.mcmeta`.
  Use `pack_format` 15 for 1.20.1.
- A `ResourceLocation` accepts only `[a-z0-9_./-]`.
- For posed meshes, a custom mesh file drawn with `RenderType.entityCutoutNoCull` is more robust than `forge:obj`.
  `forge:obj` has problems with block-atlas textures and `usemtl`.

## Check the result

Render preview sheets from the files that you wrote, and look at them.
