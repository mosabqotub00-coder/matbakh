import "dotenv/config";
import { open, realpath, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { staffUsers } from "../drizzle/schema";
import { getDb } from "../server/db";
import { createStaffAccount } from "../server/staff";

async function main() {
  const [flag, output] = process.argv.slice(2);
  if (flag !== "--output" || !output || !path.isAbsolute(output)) throw new Error("Provide --output /absolute/private-path.json");
  const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  const parent = await realpath(path.dirname(output));
  const rel = path.relative(root, parent);
  if (rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== "..")) throw new Error("Credentials must be saved outside the project.");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");
  const [manager] = await db.select({ id: staffUsers.id, role: staffUsers.role, isActive: staffUsers.isActive, mustChangePassword: staffUsers.mustChangePassword, branchId: staffUsers.branchId }).from(staffUsers).where(eq(staffUsers.username, "manager")).limit(1);
  if (!manager || manager.role !== "system_admin" || !manager.isActive) throw new Error("An active system manager is required.");
  const [existing] = await db.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.username, "developer")).limit(1);
  if (existing) throw new Error("developer already exists. Refusing to reset any password.");
  const file = await open(output, "wx", 0o600);
  let created = false;
  try {
    const password = randomBytes(18).toString("base64url");
    const user = await createStaffAccount(manager, { username: "developer", displayName: "مطوّر النظام", role: "developer", branchId: null, usualShift: null, password });
    created = true;
    await file.writeFile(`${JSON.stringify({ username: user.username, temporaryPassword: password, role: "المطوّر", mustChangePassword: true }, null, 2)}\n`);
    await file.sync();
  } catch (error) {
    if (!created) await unlink(output);
    throw error;
  } finally {
    await file.close();
  }
  console.log("Developer account created. Temporary credentials saved privately; existing passwords were not changed.");
}
main().then(() => process.exit(0)).catch(() => { console.error("Developer initialization failed; no existing password was reset."); process.exit(1); });
