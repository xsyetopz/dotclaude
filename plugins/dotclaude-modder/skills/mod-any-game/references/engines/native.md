# Native engines without a mod loader (C, C++, custom engines)

Use this playbook when `um scan` reports an unknown native engine, or when the loader cannot reach the idea.
It is the most work, and agents and reverse-engineering MCP servers help most here.
Work only in single-player, offline, or on servers that the user runs.
Do not work on games with anti-cheat (see `safety.md`).

## 1. Get code into the process

- Proxy DLL: put a DLL in the game folder with the name of a DLL that the game loads (`version.dll`, `dinput8.dll`, `winmm.dll`, `dxgi.dll`, `d3d9.dll`, or `xinput1_3.dll`).
  It forwards the real exports and runs your code in `DllMain`.
  Start a thread there and do almost nothing under the loader lock.
  Check the imports of the game first with `dumpbin /imports` or PE-bear.
- Ultimate ASI Loader (ThirteenAG) is a ready-made proxy.
  It loads `*.asi` plugins (renamed DLLs) from the game folder or `scripts/`.
  Many older games already use it.
- Other hosts: script extenders, or a framework that the community built (see `big-frameworks.md`).
  A launcher that starts the game suspended and injects is the last resort.
- Proton or Linux: use `WINEDLLOVERRIDES="dinput8=n,b" %command%`.

## 2. Find what to hook

- Static analysis: Ghidra or IDA, driven by an agent through MCP.
  Start from strings (UI text, log messages, asset names) and imports (D3D, XInput, file APIs).
  Follow cross-references to the function that handles the feature that you want to change.
  Name functions and structs as you go, and write them in `MODLOG.md`.
- Dynamic analysis:
  - Cheat Engine: scan for values (health, ammo, position), find what writes them, then walk back to the struct and its owner.
  - x64dbg: breakpoints and traces.
  - ReClass.NET: rebuild structs from live memory.
  - MCP versions of Cheat Engine, x64dbg, and Frida let an agent do this.
    Bind them to localhost.
- Use signatures, not addresses.
  Find functions with an AOB (byte pattern) scan at startup, with wildcards for relocations, so the mod survives game updates.
  Keep a fallback and log clearly when a pattern is not found.

## 3. Hook

- MinHook, SafetyHook, or Microsoft Detours: detour the function and call the original through the trampoline.
  Match the calling convention exactly.
  x64 has one convention.
  x86 needs care with `__thiscall` and `__stdcall`.
- Mid-function hooks (SafetyHook `MidHook`) change registers at a single instruction.
- Keep hooks small.
  Do heavy work on your own thread or out of process.

## 4. Draw and interact

- Overlay or UI: hook `IDXGISwapChain::Present` (D3D11 and D3D12) or `vkQueuePresentKHR` (Vulkan), then render Dear ImGui.
  Kiero is a small helper that finds these.
  The ReShade addon API gives `present`, `draw_indexed`, render-target, and depth events without your own hooks.
- To inject 3D content into the render pass of the game, use its view-projection matrices and its depth buffer.
  Find the matrices in constant buffers with RenderDoc.
  The ReShade addon examples cover depth access and buffer inspection.
  RenderDoc (with renderdoc-mcp) shows which pass draws what.
- Input: hook the input handling of the game, or use raw input or XInput.

## 5. Reimplementation instead of patching

When you understand enough of the game, you can rewrite the engine (IW4L for MW2, in Rust).
Such projects read the game files of the user, and the original binary is the oracle.
Others decompile function by function with a byte-matching harness.
See `retro-decomp.md` and the `mashup-mods` skill.

## Pitfalls

- ASLR: compute addresses from the module base at run time.
  Do not hard-code absolute addresses.
- Threads: engines expect calls on their main thread.
  Queue work and run it from a hooked per-frame function.
- Crashes: write a log file and flush it.
  Install an unhandled-exception filter that writes a minidump.
- Game updates move everything.
  Pin the game version for development and document the build that you support.
