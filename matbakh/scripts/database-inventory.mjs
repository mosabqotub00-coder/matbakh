import mysql from "mysql2/promise";
import { readFile, writeFile } from "node:fs/promises";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const quote = name => `\`${name.replaceAll("`", "``")}\``;
try {
  const [tables] = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
  const expected = [];
  for (const file of ["schema.ts", "communications-schema.ts", "notifications-schema.ts", "integration-schema.ts"]) {
    const source = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    expected.push(...[...source.matchAll(/mysqlTable\(\s*"([^"]+)"/g)].map(match => match[1]));
  }
  const names = new Set(tables.map(table => table.name));
  const counts = {};
  for (const table of tables) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS total FROM ${quote(table.name)}`);
    counts[table.name] = row.total;
  }
  const [branches] = await connection.query("SELECT b.id, b.name, b.city, b.ordersEnabled, (SELECT COUNT(*) FROM staff_users s WHERE s.branch_id=b.id) AS staffCount, (SELECT COUNT(*) FROM products p WHERE p.branchId=b.id) AS productCount, (SELECT COUNT(*) FROM kitchenOrders o WHERE o.branchId=b.id) AS orderCount FROM branches b ORDER BY b.id");
  const [accounts] = await connection.query("SELECT id, username, display_name AS displayName, role, branch_id AS branchId, usual_shift AS usualShift, is_active AS isActive, must_change_password AS mustChangePassword FROM staff_users ORDER BY id");
  const [invalidAccounts] = await connection.query("SELECT s.id, s.username, s.role, s.branch_id AS branchId FROM staff_users s LEFT JOIN branches b ON b.id=s.branch_id WHERE (s.role NOT IN ('system_admin','developer') AND (s.branch_id IS NULL OR b.id IS NULL)) OR (s.role IN ('system_admin','developer') AND s.branch_id IS NOT NULL)");
  const [[orphanProducts]] = await connection.query("SELECT COUNT(*) AS total FROM products p LEFT JOIN branches b ON b.id=p.branchId WHERE b.id IS NULL");
  const [[orphanOrders]] = await connection.query("SELECT COUNT(*) AS total FROM kitchenOrders o LEFT JOIN branches b ON b.id=o.branchId WHERE b.id IS NULL");
  const report = { generatedAt: new Date().toISOString(), missingTables: expected.filter(name => !names.has(name)), counts, branches, accounts, integrity: { invalidAccounts, orphanProducts: orphanProducts.total, orphanOrders: orphanOrders.total } };
  if (process.argv[2]) await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await connection.end();
}
