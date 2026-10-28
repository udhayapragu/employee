export type ProviderId = "mock" | "google_places";
export type ProviderMode = "mock" | "real";

export interface ResearchQuery {
  category: string;
  state: string;
  city: string | null;
  limit: number;
}

/**
 * A research provider returns raw, untrusted candidate objects. The service validates every item
 * with the candidate schema before anything is stored, so providers cannot inject unchecked fields.
 */
export interface ResearchProvider {
  readonly id: ProviderId;
  readonly mode: ProviderMode;
  search: (query: ResearchQuery, signal: AbortSignal) => Promise<unknown[]>;
}

export class ResearchProviderError extends Error {
  constructor(
    message: string,
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "ResearchProviderError";
  }
}

export function buildResearchQueryLabel(query: ResearchQuery): string {
  return `category=${query.category}; state=${query.state}; city=${query.city ?? "-"}; limit=${query.limit}`;
}
