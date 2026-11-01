import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import {
  getStaffSessionContext,
  STAFF_SESSION_COOKIE,
  type StaffSessionUser,
} from "../staff";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  staffUser: StaffSessionUser | null;
  staffSessionHash: string | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const cookiePrefix = `${STAFF_SESSION_COOKIE}=`;
  const cookiePair = (opts.req.headers.cookie ?? "")
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(cookiePrefix));
  const token = cookiePair?.slice(cookiePrefix.length);
  let staffSession: Awaited<ReturnType<typeof getStaffSessionContext>> = null;
  if (token) {
    try {
      staffSession = await getStaffSessionContext(token);
    } catch (error) {
      console.warn("[StaffAuth] Could not load staff session:", error);
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    staffUser: staffSession?.user ?? null,
    staffSessionHash: staffSession?.tokenHash ?? null,
  };
}
