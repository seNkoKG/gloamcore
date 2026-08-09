export type PlannerAsyncRequestStatus = "current" | "changed" | "superseded";

export interface PlannerAsyncRequestToken {
  lane: string;
  request: number;
  revision: number;
}

/**
 * Coordinates async planner workflows without coupling them to React timing.
 * A lane provides latest-request-wins ordering, while the shared revision makes
 * any local planner edit invalidate results calculated from older state.
 */
export class PlannerAsyncRevisionGuard {
  private revision = 0;
  private readonly latestByLane = new Map<string, number>();

  markChanged() {
    this.revision += 1;
    return this.revision;
  }

  begin(lane: string): PlannerAsyncRequestToken {
    const request = (this.latestByLane.get(lane) || 0) + 1;
    this.latestByLane.set(lane, request);
    return { lane, request, revision: this.revision };
  }

  isLatest(token: PlannerAsyncRequestToken) {
    return this.latestByLane.get(token.lane) === token.request;
  }

  inspect(token: PlannerAsyncRequestToken): PlannerAsyncRequestStatus {
    if (!this.isLatest(token)) return "superseded";
    return token.revision === this.revision ? "current" : "changed";
  }
}
