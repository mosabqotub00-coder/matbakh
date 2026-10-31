import { createHash, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import { processDeadlineNotifications } from "./notifications";

export function standaloneMaintenanceAuthorized(req: Pick<Request, "get">) {
  if (process.env.DEPLOYMENT_MODE !== "standalone") return false;
  const expected = process.env.MAINTENANCE_TOKEN ?? "";
  if (expected.length < 32) return false;
  const authorization = req.get("Authorization") ?? "";
  const match = /^Bearer (\S+)$/.exec(authorization);
  if (!match) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(match[1]), digest(expected));
}

export function registerStandaloneMaintenance(app: Express) {
  app.post("/api/maintenance/deadlines", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!standaloneMaintenanceAuthorized(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const result = await processDeadlineNotifications();
      res.json({ ok: true, mode: "standalone", ...result });
    } catch {
      res.status(503).json({ error: "deadline_processing_unavailable" });
    }
  });
}
