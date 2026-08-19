import { ApiError } from "../errors/api-error.js";

const DEFAULT_WINDOW_MS = 60_000;

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly windowMs = DEFAULT_WINDOW_MS,
  ) {}

  consume(key: string, limit: number): void {
    const currentTime = this.now();
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
}
