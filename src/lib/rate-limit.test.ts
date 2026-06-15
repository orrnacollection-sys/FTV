import { describe, it, expect } from "vitest";
import { rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  it("allows up to max, then blocks", () => {
    const key = `t1:${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, 3, 1_000).ok).toBe(true);
    }
    expect(rateLimit(key, 3, 1_000).ok).toBe(false);
  });

  it("isolates buckets per key", () => {
    const a = `t2:${Math.random()}`;
    const b = `t3:${Math.random()}`;
    rateLimit(a, 1, 1_000);
    expect(rateLimit(a, 1, 1_000).ok).toBe(false);
    expect(rateLimit(b, 1, 1_000).ok).toBe(true);
  });
});
