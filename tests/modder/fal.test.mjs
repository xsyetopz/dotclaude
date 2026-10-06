import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UmError } from "../../plugins/dotclaude-modder/um/common.mjs";
import {
  CDN,
  commands,
  downloadOutputs,
  kv,
  upload,
  urlsIn,
} from "../../plugins/dotclaude-modder/um/fal.mjs";

const realFetch = globalThis.fetch;
const env = { ...process.env };
let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "um-fal-"));
  process.env.FAL_KEY = "test-key";
  delete process.env.CLAUDE_PLUGIN_OPTION_FAL_KEY;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...env };
  fs.rmSync(tmp, { recursive: true, force: true });
});

const failure = async (promise) => {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(UmError);
    return e.message;
  }
  throw new Error("expected an UmError");
};

test("kv and urls", () => {
  expect(kv(["prompt=a cat", "num_images:=2", "flag:=true"])).toEqual({
    prompt: "a cat",
    num_images: 2,
    flag: true,
  });
  const res = {
    images: [
      { url: "https://v3.fal.media/a.png", content_type: "image/png" },
      { url: "https://v3.fal.media/b.png" },
    ],
    mask_image: { url: "https://v3.fal.media/m.png" },
  };
  expect([...urlsIn(res)].map(([, u]) => u)).toEqual([
    "https://v3.fal.media/a.png",
    "https://v3.fal.media/b.png",
    "https://v3.fal.media/m.png",
  ]);
});

test("upload uses the CDN token and explains big failures", async () => {
  // storage/upload/initiate?storage_type=gcs answers 400 "Invalid storage type", so big files failed silently
  const sent = [];
  let cdnWorks = true;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), init });
    if (String(url).includes("/storage/auth/token"))
      return Response.json({ token: "t", token_type: "Bearer" });
    if (!cdnWorks) throw new Error("boom");
    return Response.json({ access_url: "https://v3.fal.media/files/x/a.png" });
  };
  const f = path.join(tmp, "a.png");
  fs.writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  expect(await upload(f)).toBe("https://v3.fal.media/files/x/a.png");
  expect(sent[0].url).toContain("storage_type=fal-cdn-v3");
  expect(sent[0].init.headers.Authorization).toBe("Key test-key");
  expect(sent[1].url).toBe(`${CDN}/files/upload`);
  expect(sent[1].init.headers.Authorization).toBe("Bearer t");
  expect(sent[1].init.headers["X-Fal-File-Name"]).toBe("a.png");

  cdnWorks = false;
  expect((await upload(f)).startsWith("data:image/png;base64,")).toBe(true); // small: inline fallback
  const big = path.join(tmp, "big.mp4");
  fs.writeFileSync(big, Buffer.alloc((8 << 20) + 1));
  expect(await failure(upload(big))).toContain("covers only files under 8 MiB");
});

test("a missing key names both settings", async () => {
  delete process.env.FAL_KEY;
  const msg = await failure(commands.price.run({}, ["x/y"]));
  expect(msg).toContain("`fal_key`");
  expect(msg).toContain("`FAL_KEY`");
  process.env.CLAUDE_PLUGIN_OPTION_FAL_KEY = "from-option";
  let auth;
  globalThis.fetch = async (_url, init) => {
    auth = init.headers.Authorization;
    return Response.json({});
  };
  await commands.price.run({}, ["x/y"]);
  expect(auth).toBe("Key from-option"); // the plugin option wins
});

test("a failed download keeps the request id", async () => {
  // a finished (paid) job whose output URL answers 404 must not vanish: say which request to fetch again
  globalThis.fetch = async (url) =>
    String(url).endsWith("big.mov")
      ? new Response("Not Found", { status: 404 })
      : new Response("ok");
  const res = {
    video: { url: "https://v3b.fal.media/files/x/big.mov" },
    thumb: { url: "https://v3b.fal.media/files/x/t.png" },
    _request_id: "req-123",
    _endpoint: "fal-ai/some-model",
  };
  const msg = await failure(downloadOutputs(res, tmp, "clip"));
  expect(msg).toContain("big.mov");
  expect(msg).toContain("um fal result fal-ai/some-model req-123");
  expect(fs.readFileSync(path.join(tmp, "clip_thumb.png"), "utf8")).toBe("ok"); // the other outputs still saved
});
