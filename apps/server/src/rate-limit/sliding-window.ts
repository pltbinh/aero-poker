import { ApiError } from "../errors/api-error.js";

const DEFAULT_WINDOW_MS = 60_000;

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private lastGlobalPruneAt: number;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly windowMs = DEFAULT_WINDOW_MS,
  ) {
    this.lastGlobalPruneAt = this.now();
  }

  consume(key: string, limit: number): void {
    const currentTime = this.now();
    this.pruneBucket(key, currentTime);

    if (currentTime - this.lastGlobalPruneAt >= this.windowMs) {
      this.pruneExpiredBuckets(currentTime);
      this.lastGlobalPruneAt = currentTime;
    }

    const bucket = this.buckets.get(key) ?? [];
    let firstValidIndex = 0;

    while (firstValidIndex < bucket.length && currentTime - bucket[firstValidIndex]! >= this.windowMs) {
      firstValidIndex += 1;
    }

    const activeEntries = firstValidIndex === 0 ? bucket : bucket.slice(firstValidIndex);

    if (activeEntries.length >= limit) {
      this.buckets.set(key, activeEntries);
      throw new ApiError("RATE_LIMITED", 429, "Too many requests. Try again in one minute.");
    }

    activeEntries.push(currentTime);
    this.buckets.set(key, activeEntries);
  }

  private pruneBucket(key: string, currentTime: number): void {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return;
    }

    let firstValidIndex = 0;

    while (firstValidIndex < bucket.length && currentTime - bucket[firstValidIndex]! >= this.windowMs) {
      firstValidIndex += 1;
    }

    if (firstValidIndex >= bucket.length) {
      this.buckets.delete(key);
    } else if (firstValidIndex > 0) {
      this.buckets.set(key, bucket.slice(firstValidIndex));
    }
  }

  private pruneExpiredBuckets(currentTime: number): void {
    for (const [key, bucket] of this.buckets.entries()) {
      let firstValidIndex = 0;

      while (firstValidIndex < bucket.length && currentTime - bucket[firstValidIndex]! >= this.windowMs) {
        firstValidIndex += 1;
      }

      if (firstValidIndex >= bucket.length) {
        this.buckets.delete(key);
        continue;
      }

      if (firstValidIndex > 0) {
        this.buckets.set(key, bucket.slice(firstValidIndex));
      }
    }
  }
}
