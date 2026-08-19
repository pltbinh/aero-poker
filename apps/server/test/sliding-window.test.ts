import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter } from "../src/rate-limit/sliding-window.js";

function createClock(start = 0) {
  let current = start;

  return {
    now: () => current,
    advanceBy: (ms: number) => {
      current += ms;
    },
  };
}

function bucketKeys(limiter: SlidingWindowRateLimiter): string[] {
  return Array.from((limiter as unknown as { buckets: Map<string, number[]> }).buckets.keys()).sort();
}

class CountingBuckets extends Map<string, number[]> {
  scanCount = 0;

  override entries(): MapIterator<[string, number[]]> {
    this.scanCount += 1;
    return super.entries();
  }
}

describe("SlidingWindowRateLimiter", () => {
  it("allows a previously blocked key again once the one-minute window rolls over", () => {
    const clock = createClock();
    const limiter = new SlidingWindowRateLimiter(clock.now);

    limiter.consume("participant-1", 2);
    limiter.consume("participant-1", 2);

    expect(() => limiter.consume("participant-1", 2)).toThrowError(
      expect.objectContaining({ code: "RATE_LIMITED" }),
    );

    clock.advanceBy(60_000);

    expect(() => limiter.consume("participant-1", 2)).not.toThrow();
  });

  it("evicts expired keys when newer requests arrive", () => {
    const clock = createClock();
    const limiter = new SlidingWindowRateLimiter(clock.now);

    limiter.consume("stale", 1);

    expect(bucketKeys(limiter)).toEqual(["stale"]);

    clock.advanceBy(60_000);
    limiter.consume("fresh", 1);

    expect(bucketKeys(limiter)).toEqual(["fresh"]);
  });

  it("does not sweep every request but performs periodic cleanup", () => {
    const clock = createClock();
    const limiter = new SlidingWindowRateLimiter(clock.now);
    const buckets = new CountingBuckets();

    (limiter as unknown as { buckets: Map<string, number[]> }).buckets = buckets;

    limiter.consume("stale", 1);
    limiter.consume("hot", 2);
    buckets.scanCount = 0;

    limiter.consume("hot", 2);

    expect(buckets.scanCount).toBe(0);

    clock.advanceBy(60_000);
    limiter.consume("fresh", 1);

    expect(buckets.scanCount).toBe(1);
    expect(bucketKeys(limiter)).toEqual(["fresh"]);
  });
});
