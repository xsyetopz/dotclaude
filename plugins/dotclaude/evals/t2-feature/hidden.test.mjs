import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./cli.mjs";
import { createStore } from "./store.mjs";

test("hidden: done marks one item", () => {
  const store = createStore();
  run(store, ["add", "a"]);
  run(store, ["add", "b", "c"]);
  assert.equal(store.done(2), true);
  assert.equal(store.done(9), false);
  assert.equal(run(store, ["done", "1"]), "done 1");
  assert.equal(run(store, ["done", "7"]), "no item 7");
  assert.equal(run(store, ["list"]), "1. a (done)\n2. b c (done)");
});

test("hidden: list without done items is unchanged", () => {
  const store = createStore();
  run(store, ["add", "x"]);
  assert.equal(run(store, ["list"]), "1. x");
  assert.equal(run(store, ["nope"]), "unknown command: nope");
});
