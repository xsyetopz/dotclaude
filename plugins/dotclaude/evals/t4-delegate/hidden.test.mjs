import assert from "node:assert/strict";
import { test } from "node:test";
import { Stack } from "./stack.mjs";

test("hidden: pop, peek, size", () => {
  const stack = new Stack();
  assert.equal(stack.size, 0);
  assert.equal(stack.pop(), undefined);
  assert.equal(stack.peek(), undefined);
  stack.push(1);
  stack.push(2);
  assert.equal(stack.size, 2);
  assert.equal(stack.peek(), 2);
  assert.equal(stack.pop(), 2);
  assert.equal(stack.pop(), 1);
  assert.equal(stack.size, 0);
});
