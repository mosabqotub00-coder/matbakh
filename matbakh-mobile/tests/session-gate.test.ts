import { describe, expect, it } from "vitest";
import {
  INITIAL_SESSION_GATE,
  isCurrentAuthenticatedSession,
  transitionSessionGate,
} from "../lib/session-gate";

describe("native device session gate", () => {
  it("allows work started under the current authenticated session", () => {
    const signedIn = transitionSessionGate(INITIAL_SESSION_GATE, true);
    expect(isCurrentAuthenticatedSession(signedIn, signedIn)).toBe(true);
  });

  it("invalidates an in-flight permission/token result after logout", () => {
    const signedIn = transitionSessionGate(INITIAL_SESSION_GATE, true);
    const signedOut = transitionSessionGate(signedIn, false);
    expect(isCurrentAuthenticatedSession(signedOut, signedIn)).toBe(false);
  });

  it("invalidates work after password-change state replaces a prior session", () => {
    const signedIn = transitionSessionGate(INITIAL_SESSION_GATE, true);
    const passwordChangeRequired = transitionSessionGate(signedIn, false);
    expect(passwordChangeRequired.generation).toBeGreaterThan(signedIn.generation);
    expect(isCurrentAuthenticatedSession(passwordChangeRequired, signedIn)).toBe(false);
  });
});
