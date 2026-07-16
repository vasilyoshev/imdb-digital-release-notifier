export type EventKind = "announced" | "released" | "date_changed";

export interface MediumLogState {
  announcedEver: boolean;
  releasedEver: boolean;
  /** effective_date of the most recent log row for (movie, medium), any kind incl. seeded */
  lastLoggedDate: string | null;
}

export interface DetectInput {
  currentEffective: string | null;
  state: MediumLogState;
  isNewMovie: boolean;
  today: string;
}

export interface DetectedEvent {
  event: EventKind;
  effectiveDate: string;
  /** true = past fact at first observation → orchestrator seeds it silently */
  pastFactOnFirstObservation: boolean;
}

export function detectMediumEvents(
  { currentEffective, state, isNewMovie, today }: DetectInput,
): DetectedEvent[] {
  if (!currentEffective || state.releasedEver) return [];
  if (currentEffective <= today) {
    // Same-run precedence: released suppresses announced and date_changed.
    return [{
      event: "released",
      effectiveDate: currentEffective,
      pastFactOnFirstObservation: isNewMovie && currentEffective < today,
    }];
  }
  if (!state.announcedEver) {
    return [{ event: "announced", effectiveDate: currentEffective, pastFactOnFirstObservation: false }];
  }
  if (state.lastLoggedDate !== null && state.lastLoggedDate !== currentEffective) {
    return [{ event: "date_changed", effectiveDate: currentEffective, pastFactOnFirstObservation: false }];
  }
  return [];
}
