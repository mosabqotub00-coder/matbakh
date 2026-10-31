import "dotenv/config";
import { randomBytes } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { branches, staffUsers } from "../drizzle/schema";
import { getDb } from "../server/db";
import { createStaffAccount } from "../server/staff";
import type { StaffRole } from "../shared/roles";

async function main() {
  const [flag, output] = process.argv.slice(2);
  if (flag !== "--output" || !output || !path.isAbsolute(output)) throw new Error("Provide --output /absolute/private-file.json");
  const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  const parent = await realpath(path.dirname(output));
  const rel = path.relative(root, parent);
  if (rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== "..")) throw new Error("Credential file must be outside the project.");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");
  const [actor] = await db.select({ id: staffUsers.id, role: staffUsers.role, branchId: staffUsers.branchId, isActive: staffUsers.isActive }).from(staffUsers).where(eq(staffUsers.username, "manager")).limit(1);
  if (!actor || actor.role !== "system_admin" || !actor.isActive) throw new Error("An active system manager is required.");
  const existingBranches = await db.select().from(branches);
  const existingUsers = await db.select({ username: staffUsers.username }).from(staffUsers);
  const definitions = [
    { name: "فرع فيصل", city: "نابلس", slug: "faisal" },
    { name: "فرع سفيان", city: "نابلس", slug: "sufian" },
    { name: "فرع رفيديا", city: "نابلس", slug: "rafidia" },
    { name: "فرع بلازا مول", city: "رام الله", slug: "plaza_mall" },
    { name: "فرع الطيرة", city: "رام الله", slug: "tira" },
  ];
  const roles: { prefix: string; suffix: string; role: StaffRole; label: string; shift: "morning" | "evening" | "flexible" }[] = [
    { prefix: "branch_manager", suffix: "", role: "branch_manager", label: "مدير الفرع", shift: "flexible" },
    { prefix: "kitchen_manager", suffix: "", role: "kitchen_manager", label: "مدير المطبخ", shift: "flexible" },
    { prefix: "supervisor", suffix: "", role: "shift_manager", label: "المشرف", shift: "flexible" },
    { prefix: "station", suffix: "_morning", role: "station", label: "موظف السخان الصباحي", shift: "morning" },
    { prefix: "station", suffix: "_evening", role: "station", label: "موظف السخان المسائي", shift: "evening" },
    { prefix: "kitchen", suffix: "_morning", role: "kitchen", label: "موظف المطبخ الصباحي", shift: "morning" },
    { prefix: "kitchen", suffix: "_evening", role: "kitchen", label: "موظف المطبخ المسائي", shift: "evening" },
  ];
  const planned = definitions.flatMap(definition => {
    const matches = existingBranches.filter(branch => branch.name === definition.name && branch.city === definition.city);
    if (matches.length !== 1) throw new Error(`Branch mapping is ambiguous or missing: ${definition.name}`);
    return roles.map(role => ({ branchId: matches[0].id, branch: definition.name, city: definition.city, username: `${role.prefix}_${definition.slug}${role.suffix}`, role: role.role, roleLabel: role.label, usualShift: role.shift, temporaryPassword: randomBytes(18).toString("base64url"), mustChangePassword: true, status: "planned" }));
  });
  if (planned.some(item => existingUsers.some(user => user.username === item.username))) throw new Error("A planned username already exists. No existing password will be reset.");
  const file = await open(output, "wx", 0o600);
  const save = async () => {
    const content = `${JSON.stringify({ generatedAt: new Date().toISOString(), site: "https://matbakh-434fqg4g.manus.space", accounts: planned }, null, 2)}\n`;
    await file.write(content, 0, "utf8");
    await file.truncate(Buffer.byteLength(content));
    await file.sync();
  };
  try {
    // Persist credentials before creating each account, so they cannot be lost after insertion.
    await save();
    for (const item of planned) {
      await createStaffAccount(actor, { username: item.username, password: item.temporaryPassword, displayName: `${item.roleLabel} — ${item.branch}`, role: item.role, branchId: item.branchId, usualShift: item.usualShift });
      item.status = "created";
      await save();
      console.log(`Created ${item.username} for ${item.branch}`);
    }
  } finally {
    await file.close();
  }
  console.log("35 independent branch accounts created; private credentials saved, existing accounts unchanged.");
}
main().then(() => process.exit(0)).catch(() => { console.error("Provisioning stopped. Inspect the private credential journal before retrying. Existing passwords were never reset."); process.exit(1); });
