import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import {
  getStaffSessionContext,
  STAFF_SESSION_COOKIE,
  type StaffSessionUser,
} from "../staff";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  staffUser: StaffSessionUser | null;
  staffSessionHash: string | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    if (process.env.DEPLOYMENT_MODE !== "standalone") {
      user = await sdk.authenticateRequest(opts.req);
    }
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

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
    user,
    staffUser: staffSession?.user ?? null,
    staffSessionHash: staffSession?.tokenHash ?? null,
  };
}
