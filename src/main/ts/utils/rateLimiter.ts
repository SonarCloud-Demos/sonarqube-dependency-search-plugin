/**
 * Sliding-window rate limiter: at most `requestsPerSecond` calls to `schedule`
 * are allowed to start within any trailing 1-second window. Excess callers queue
 * and wait their turn rather than being rejected — this throttles dispatch rate
 * to a SonarQube instance regardless of how many scopes are fanned out concurrently.
 */
export class RateLimiter {
  private timestamps: number[] = [];

  constructor(private requestsPerSecond: number) {}

  setRate(requestsPerSecond: number): void {
    this.requestsPerSecond = requestsPerSecond;
  }

  getRate(): number {
    return this.requestsPerSecond;
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForSlot();
    return fn();
  }

  private waitForSlot(): Promise<void> {
    return new Promise((resolve) => {
      const attempt = () => {
        const now = Date.now();
        this.timestamps = this.timestamps.filter((t) => now - t < 1000);
        if (this.timestamps.length < this.requestsPerSecond) {
          this.timestamps.push(now);
          resolve();
          return;
        }
        const oldest = this.timestamps[0];
        setTimeout(attempt, Math.max(1000 - (now - oldest), 5));
      };
      attempt();
    });
  }
}
