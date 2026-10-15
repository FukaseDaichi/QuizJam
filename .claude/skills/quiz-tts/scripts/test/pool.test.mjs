import { test } from "node:test";
import assert from "node:assert/strict";
import { runPool } from "../lib/pool.mjs";

test("runPool: 順序を保ち、同時実行数を超えない", async () => {
  let running = 0;
  let peak = 0;
  const out = await runPool([1, 2, 3, 4, 5], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
  assert.equal(peak, 2);
});

test("runPool: 空配列なら空", async () => {
  assert.deepEqual(await runPool([], 2, async () => 1), []);
});
