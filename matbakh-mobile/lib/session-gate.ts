export type SessionGate = Readonly<{ active: boolean; generation: number }>;

export const INITIAL_SESSION_GATE: SessionGate = { active: false, generation: 0 };

/** Each website auth-state transition invalidates in-flight native permission/token work. */
export function transitionSessionGate(previous: SessionGate, active: boolean): SessionGate {
  return { active, generation: previous.generation + 1 };
}

export function isCurrentAuthenticatedSession(current: SessionGate, captured: SessionGate) {
  return current.active && current.generation === captured.generation;
}
