import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";
const mocked = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock("./notifications", () => ({
  processDeadlineNotifications: mocked.process,
}));
import {
  registerStandaloneMaintenance,
  standaloneMaintenanceAuthorized,
} from "./standalone-maintenance";
const key = "a".repeat(64);
const request = (header?: string) =>
  ({ get: () => header }) as Pick<Request, "get">;
beforeEach(() => {
  vi.stubEnv("DEPLOYMENT_MODE", "standalone");
  vi.stubEnv("MAINTENANCE_TOKEN", key);
  mocked.process.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
describe("standalone maintenance authentication", () => {
  it("is disabled on the current Manus deployment even if a token is supplied", () => {
    vi.stubEnv("DEPLOYMENT_MODE", "");
    expect(standaloneMaintenanceAuthorized(request(`Bearer ${key}`))).toBe(
      false
    );
  });
  it("rejects empty or short server secrets", () => {
    vi.stubEnv("MAINTENANCE_TOKEN", "change-me");
    expect(standaloneMaintenanceAuthorized(request("Bearer change-me"))).toBe(
      false
    );
  });
  it("rejects missing headers, wrong tokens, and token-like extra text", () => {
    for (const header of [
      undefined,
      "Basic value",
      "Bearer wrong",
      `Bearer ${key} extra`,
    ])
      expect(standaloneMaintenanceAuthorized(request(header))).toBe(false);
  });
  it("accepts the exact strong server token in standalone mode", () =>
    expect(standaloneMaintenanceAuthorized(request(`Bearer ${key}`))).toBe(
      true
    ));
  it("does not run checks for an unauthorized HTTP request", async () => {
    let handler: (
      req: Request,
      res: Response
    ) => Promise<void> = async () => {};
    registerStandaloneMaintenance({
      post: (_path: string, callback: typeof handler) => {
        handler = callback;
      },
    } as unknown as Express);
    const res = {
      set: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    await handler(request() as Request, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocked.process).not.toHaveBeenCalled();
  });
  it("runs the shared checker only after authentication and reports a thrown failure", async () => {
    let handler: (
      req: Request,
      res: Response
    ) => Promise<void> = async () => {};
    registerStandaloneMaintenance({
      post: (_path: string, callback: typeof handler) => {
        handler = callback;
      },
    } as unknown as Express);
    const res = {
      set: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    mocked.process.mockResolvedValueOnce({ checked: 2, emitted: 1 });
    await handler(request(`Bearer ${key}`) as Request, res);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      mode: "standalone",
      checked: 2,
      emitted: 1,
    });
    mocked.process.mockRejectedValueOnce(new Error("database unavailable"));
    await handler(request(`Bearer ${key}`) as Request, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
