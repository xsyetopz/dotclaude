# Unity

## Identify

The game has `UnityPlayer.dll` and a `<Game>_Data/` folder.

- Mono backend: `<Game>_Data/Managed/Assembly-CSharp.dll` exists.
  The game logic is plain .NET IL, so modding is easy.
- IL2CPP backend: `GameAssembly.dll` and `<Game>_Data/il2cpp_data/Metadata/global-metadata.dat` exist.
  The logic is native code, so mods work through generated interop.
- Version: `um scan` reads it from `globalgamemanagers`.
  It decides which loader build works.
- Save and config path: `%USERPROFILE%\AppData\LocalLow\<company>\<product>\` (from `<Game>_Data/app.info`).
  `Player.log` is there too.
  It is the first log to read.

## Route 1: an existing community loader (check first)

Many Unity games have a modding scene on Thunderstore (r2modman) or Nexus.
If the scene has a library such as `<game>API`, `R2API`, or `Jotunn`, build on it.
Examples:

- RimWorld: XML Defs and Harmony
- Valheim: Jotunn
- Risk of Rain 2: R2API
- Lethal Company
- Hollow Knight: its own Modding API, installed with Lumafly

## Route 2: BepInEx or MelonLoader with Harmony

- BepInEx 5 (Mono):
  1. Unzip it into the game folder.
     It adds `winhttp.dll` (the Doorstop proxy) and `doorstop_config.ini`.
  1. Run the game once to make `BepInEx/config`.
  1. Plugins are .NET assemblies in `BepInEx/plugins/`.
  1. The log is `BepInEx/LogOutput.log`.
     Turn on the console in `BepInEx.cfg`.
- BepInEx 6 (bleeding edge) is for IL2CPP.
  It makes interop assemblies on the first run, which is slow once.
- MelonLoader is an alternative loader.
  It puts `version.dll` in the game folder and uses `Mods/`.
- Proton or Linux: set the launch option `WINEDLLOVERRIDES="winhttp=n,b" %command%` for BepInEx, or `version=n,b` for MelonLoader.
- Plugin skeleton (BepInEx 5):

  ```csharp
  [BepInPlugin("you.mymod", "My Mod", "0.1.0")]
  public class Plugin : BaseUnityPlugin {
      void Awake() { new Harmony("you.mymod").PatchAll(); Logger.LogInfo("loaded"); }
  }
  [HarmonyPatch(typeof(PlayerController), "Update")]
  static class Patch { static void Postfix(PlayerController __instance) { /* ... */ } }
  ```

  Reference `Assembly-CSharp.dll`, the `UnityEngine*.dll` files (from `_Data/Managed`), and the BepInEx core DLLs.
  Set `<Private>false</Private>`, so the build does not copy them.
  Target the framework that the game uses (often `netstandard2.0` or `net472`).
  The NuGet packages `BepInEx.PluginInfoProps` and `BepInEx.Templates` make this skeleton.
- Harmony:
  - A prefix runs before the original.
    It skips the original when it returns false.
  - A postfix runs after.
    It can change `__result`.
  - A transpiler edits the IL, for surgical changes.
  - Use `AccessTools` for private members.
- IL2CPP: patch through the Il2CppInterop types (the `Il2Cpp*` namespaces that BepInEx 6 or MelonLoader generate).
  Register managed `MonoBehaviour` types with `ClassInjector.RegisterTypeInIl2Cpp<T>()`.

## Read the game

- Mono: ILSpy, or `ilspycmd -p -o ~/<game>-decomp Assembly-CSharp.dll`.
  dnSpyEx can debug and edit.
- IL2CPP: Cpp2IL or Il2CppDumper, with `GameAssembly.dll` and `global-metadata.dat`.
  They give type, method, and field layouts, plus dummy DLLs that ILSpy can read.
  Method bodies are native, so use Ghidra or IDA with the generated scripts to name functions.
- Live: UnityExplorer (a BepInEx or MelonLoader plugin) is an in-game hierarchy, inspector, and C# console.
  It is the fastest way to find the GameObject and component that you need.
  `bepinex-mcp` gives an agent live patching and field watches.
- Assets: AssetRipper (whole project export), UABEA or AssetStudio (browse and replace in bundles), and `UnityPy` (Python).

## Content and assets

- Load your own assets at runtime from an AssetBundle that you build with the same Unity major version (Unity Hub, empty project).
  Or load PNG files with `Texture2D.LoadImage` and build the `Sprite.Create` call yourself.
- For new items or characters, clone an existing prefab with `Object.Instantiate` and swap its mesh, material, and stats.
  This is much easier than a build from scratch.
- Audio: use `UnityWebRequestMultimedia.GetAudioClip` for wav and ogg.

## Pitfalls

- Loader builds are tied to Unity versions.
  Use the build that the community recommends for the game version.
- `DontDestroyOnLoad` objects and scene reloads: hook the scene load (`SceneManager.sceneLoaded`) to apply your state again.
- IL2CPP stripping: methods that the game never called may not exist, and generic instantiations may be missing.
- Multiplayer Unity games with anti-cheat (EAC or BattlEye, for example Rust, Tarkov, and Fall Guys): do not mod them.
