import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detect,
  Index,
  KNOWN,
  onlineOnly,
  peInfo,
  scan,
  steamGames,
  steamRoots,
  vdf,
} from "../../plugins/dotclaude-modder/um/scan.mjs";

let tmp;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "um-scan-")));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function make(root, files) {
  for (const [rel, data] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
}

function engineOf(root, files) {
  make(root, files);
  const { hits } = detect(new Index(root));
  return [hits[0].key, hits[0].det];
}

// Stand-ins for the game stores and the Windows shell, so that a test never reads the machine.
const fakes = { listGames: () => [], folders: () => ({}) };

function emptyGame(name) {
  const d = path.join(tmp, name);
  make(
    d,
    Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [`f${i}.txt`, "x"])),
  );
  return d;
}

describe("engine detection", () => {
  test("unity mono and version", () => {
    const [key, det] = engineOf(tmp, {
      "UnityPlayer.dll": "MZ",
      "Game_Data/Managed/Assembly-CSharp.dll": "MZ",
      "Game_Data/globalgamemanagers": Buffer.concat([
        Buffer.alloc(20),
        Buffer.from("2022.3.21f1\0"),
        Buffer.alloc(100),
      ]),
      "Game_Data/app.info": "Studio\nCoolGame",
    });
    expect(key).toBe("unity-mono");
    expect(det.version).toBe("2022.3.21f1");
    expect(det.product).toBe("CoolGame");
  });

  test("unity il2cpp", () => {
    const [key] = engineOf(tmp, {
      "UnityPlayer.dll": "MZ",
      "GameAssembly.dll": "MZ",
      "Game_Data/il2cpp_data/Metadata/global-metadata.dat": Buffer.from([
        0xaf, 0x1b, 0xb1, 0xfa,
      ]),
    });
    expect(key).toBe("unity-il2cpp");
  });

  test("unreal version from exe", () => {
    const exe = Buffer.concat([
      Buffer.from("MZ"),
      Buffer.alloc(5000),
      Buffer.from("++UE5+Release-5.3", "utf16le"),
      Buffer.alloc(100),
    ]);
    const [key, det] = engineOf(tmp, {
      "Proj/Binaries/Win64/Proj-Win64-Shipping.exe": exe,
      "Proj/Content/Paks/Proj-Windows.pak": "x",
      "Proj/Content/Paks/Proj-Windows.utoc": "x",
    });
    expect(key).toBe("unreal");
    expect(det.engine_version).toBe("UE5+Release-5.3");
    expect(det.iostore).toBe(true);
  });

  test("godot pck", () => {
    const pck = Buffer.alloc(20);
    pck.write("GDPC");
    for (const [i, v] of [2, 4, 2, 1].entries())
      pck.writeUInt32LE(v, 4 + i * 4);
    const [key, det] = engineOf(tmp, { "game.exe": "MZ", "game.pck": pck });
    expect(key).toBe("godot");
    expect(det.version.startsWith("4.2.1")).toBe(true);
  });

  test("godot pck embedded in the exe", () => {
    const pck = Buffer.alloc(20);
    pck.write("GDPC");
    for (const [i, v] of [2, 4, 3, 0].entries())
      pck.writeUInt32LE(v, 4 + i * 4);
    const trailer = Buffer.alloc(12);
    trailer.writeBigUInt64LE(BigInt(pck.length), 0);
    trailer.write("GDPC", 8);
    const [key, det] = engineOf(tmp, {
      "game.exe": Buffer.concat([
        Buffer.from("MZ"),
        Buffer.alloc(50),
        pck,
        trailer,
      ]),
    });
    expect(key).toBe("godot");
    expect(det.version).toBe("4.3.0 (embedded in exe)");
  });

  test("gamemaker and rpgmaker", () => {
    const data = Buffer.alloc(20);
    data.write("FORM");
    data.write("GEN8", 8);
    data[17] = 0x11;
    expect(engineOf(path.join(tmp, "a"), { "data.win": data })[0]).toBe(
      "gamemaker",
    );
    expect(
      engineOf(path.join(tmp, "b"), {
        "www/js/rpg_core.js": "//",
        "Game.exe": "MZ",
      })[0],
    ).toBe("rpgmaker-mvmz");
  });

  test("an unknown folder is a native engine", () => {
    expect(engineOf(tmp, { "readme.txt": "x" })[0]).toBe("native");
  });

  test("managed pe", () => {
    // A minimal PE32 with a CLR header directory entry.
    const pe = Buffer.alloc(1024);
    pe.write("MZ");
    pe.writeUInt32LE(0x80, 0x3c);
    pe.write("PE\0\0", 0x80, "latin1");
    pe.writeUInt16LE(0x14c, 0x84);
    const opt = 0x80 + 24;
    pe.writeUInt16LE(0x10b, opt);
    pe.writeUInt32LE(0x2000, opt + 96 + 14 * 8);
    const file = path.join(tmp, "Game.exe");
    fs.writeFileSync(file, pe);
    expect(peInfo(file)).toEqual({ arch: "x86", managed: true });
  });
});

describe("Steam", () => {
  test("vdf", () => {
    const d = vdf(
      '"AppState" { "appid" "105600" "name" "Terraria" "installdir" "Terraria" }',
    );
    expect(d.AppState.installdir).toBe("Terraria");
  });

  const cases = [
    ["SteamLibrary", "ExampleGame", "Example Game"],
    ["SteamLibrary", "ExampleGame", "Example Game\u2122"],
    ["SteamLibrary", "Jeu\u00e9", "Example Game"],
    ["Biblioth\u00e8que", "ExampleGame", "Example Game"],
  ];
  test.each(cases)(
    "games with non-ASCII names: %s, %s, %s",
    (libraryName, installName, gameName) => {
      const root = path.join(tmp, "Steam");
      const apps = path.join(tmp, libraryName, "steamapps");
      const gamePath = path.join(apps, "common", installName);
      fs.mkdirSync(gamePath, { recursive: true });
      fs.mkdirSync(path.join(root, "steamapps"), { recursive: true });
      const lib = path.join(tmp, libraryName).replaceAll("\\", "/");
      fs.writeFileSync(
        path.join(root, "steamapps/libraryfolders.vdf"),
        `"libraryfolders" { "0" { "path" "${lib}" } }`,
      );
      fs.writeFileSync(
        path.join(apps, "appmanifest_123.acf"),
        `"AppState" { "appid" "123" "name" "${gameName}" "installdir" "${installName}" }`,
      );
      expect(steamGames([root])).toEqual([
        {
          store: "steam",
          appid: "123",
          name: gameName,
          path: gamePath,
          workshop: null,
        },
      ]);
    },
  );

  test("the Steam root from the registry is a root", () => {
    // Steam can live outside Program Files.
    // Its libraryfolders.vdf was never read.
    const root = path.join(tmp, "Steam");
    fs.mkdirSync(path.join(root, "steamapps"), { recursive: true });
    expect(steamRoots(root)).toContain(fs.realpathSync(root));
  });
});

describe("scan", () => {
  test("the longest known game key wins", () => {
    // "grand theft auto v" is a substring of "grand theft auto v enhanced".
    const r = scan(emptyGame("Grand Theft Auto V Enhanced"), fakes);
    expect(r.routes[0].route).toBe(KNOWN["grand theft auto v enhanced"][0]);
  });

  test("slay the spire 2 is not sts1", () => {
    // StS2 is Godot + C#, so the StS1 entry (ModTheSpire, Java) must not match it.
    const route = scan(emptyGame("Slay the Spire 2"), fakes).routes[0].route;
    expect(route).toBe(KNOWN["slay the spire 2"][0]);
    expect(route).not.toContain("ModTheSpire");
  });

  test("a name finds an installed game", () => {
    const dir = emptyGame("Some Game");
    const games = [
      {
        store: "steam",
        appid: "9",
        name: "Some Game",
        path: dir,
        workshop: null,
      },
    ];
    const r = scan("somegame", { ...fakes, listGames: () => games });
    expect(r.store).toBe("steam");
    expect(r.path).toBe(dir);
  });
});

describe("online-only games (PR 111)", () => {
  test.each([
    "Rust",
    "Overwatch\u00ae 2",
    "Counter-Strike 2",
    "Tom Clancy's Rainbow Six\u00ae Siege",
  ])("%s is flagged", (name) => expect(onlineOnly(name)).not.toBeNull());

  test.each([
    "Rusty Lake Hotel",
    "Battlefield 1942",
    "Call of Duty: Modern Warfare 2 (2009)",
    "Trust",
  ])("%s is not flagged", (name) => expect(onlineOnly(name)).toBeNull());

  test("the warning follows the whole name", () => {
    const flagged = (name) =>
      scan(emptyGame(name), fakes).warnings.some((w) =>
        w.includes("online competitive"),
      );
    expect(flagged("Rust")).toBe(true);
    expect(flagged("Rusty Lake")).toBe(false);
  });
});
