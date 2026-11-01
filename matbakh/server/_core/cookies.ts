import type { CookieOptions, Request } from "express";

type SameSite = "lax" | "strict" | "none";

function sameSite(): SameSite {
  const value = (process.env.COOKIE_SAME_SITE ?? "lax").trim().toLowerCase();
  return value === "strict" || value === "none" ? value : "lax";
}

/** Session cookie: HttpOnly, Secure (required for SameSite=None), Lax by default for production. */
export function getSessionCookieOptions(_req: Request): CookieOptions {
  const site = sameSite();
  const secure = site === "none" || process.env.COOKIE_SECURE !== "false";
  return { httpOnly: true, path: "/", sameSite: site, secure };
}
