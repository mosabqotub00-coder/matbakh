// Run on the server only: node scripts/promote-admin.mjs <email-or-username>
// Makes an existing account an active system admin.
import "dotenv/config";
import mysql from "mysql2/promise";

const identifier = (process.argv[2] ?? "").normalize("NFKC").trim().toLowerCase();
if (!identifier) {
  console.error("Usage: node scripts/promote-admin.mjs <email-or-username>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const connection = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const column = identifier.includes("@") ? "email" : "username";
  const [rows] = await connection.query(`SELECT id, username, email FROM staff_users WHERE ${column} = ? LIMIT 1`, [identifier]);
  if (!rows.length) {
    console.error("No account with that email or username.");
    process.exit(1);
  }
  await connection.query(
    `UPDATE staff_users SET role = 'system_admin', branch_id = NULL, can_station = 1, can_kitchen = 1, can_manager = 1,
     can_manage_users = 1, can_broadcast = 1, can_extend = 1, is_active = 1, approval_status = 'approved' WHERE id = ?`,
    [rows[0].id]
  );
  console.log(`Account ${rows[0].username}${rows[0].email ? ` <${rows[0].email}>` : ""} is now an active system admin.`);
} finally {
  await connection.end();
}
