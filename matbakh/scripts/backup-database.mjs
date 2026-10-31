import mysql from "mysql2/promise";
import { exportDatabase } from "./export-database.mjs";
import { mkdir, chmod, stat, rename, unlink, realpath } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { resolve, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const parsed = new URL(process.env.DATABASE_URL);
if (parsed.protocol !== "mysql:") throw new Error("DATABASE_URL must use mysql://.");
const probe = await mysql.createConnection(process.env.DATABASE_URL);
let portable;
try {
  const [[server]] = await probe.query("SELECT VERSION() AS version");
  portable = process.env.BACKUP_DRIVER === "portable" || String(server.version).includes("TiDB");
} finally {
  await probe.end();
}
if (portable) {
  await exportDatabase();
} else {
  const projectRoot = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  const outputDir = resolve(process.env.BACKUP_DIR || join(projectRoot, "..", "matbakh-private-backups"));
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const actualOutput = await realpath(outputDir);
  const inside = relative(projectRoot, actualOutput);
  if (inside === "" || (!inside.startsWith(`..${sep}`) && inside !== "..")) throw new Error("BACKUP_DIR must be outside the project directory.");
  await chmod(actualOutput, 0o700);
  const help = spawnSync("mysqldump", ["--help"], { encoding: "utf8" });
  if (help.error || help.status !== 0) throw new Error("Install the MySQL client (mysqldump) before exporting.");
  const output = join(actualOutput, `matbakh-${new Date().toISOString().replace(/[:.]/g, "-")}.sql.gz`);
  const partial = `${output}.partial`;
  const args = [`--host=${parsed.hostname}`, `--port=${parsed.port || "3306"}`, `--user=${decodeURIComponent(parsed.username)}`, "--single-transaction", "--quick", "--hex-blob", "--routines", "--triggers", "--default-character-set=utf8mb4"];
  for (const [option, argument] of [["no-tablespaces", "--no-tablespaces"], ["column-statistics", "--column-statistics=0"], ["set-gtid-purged", "--set-gtid-purged=OFF"]]) {
    if (help.stdout.includes(option)) args.push(argument);
  }
  if (help.stdout.includes("ssl-mode")) args.push("--ssl-mode=REQUIRED");
  args.push(decodeURIComponent(parsed.pathname.slice(1)));
  const child = spawn("mysqldump", args, { env: { ...process.env, MYSQL_PWD: decodeURIComponent(parsed.password) }, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", () => {});
  const closed = new Promise((resolveClose, reject) => {
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolveClose() : reject(new Error(`Database export failed (exit ${code}); no complete backup was saved.`)));
  });
  try {
    await Promise.all([closed, pipeline(child.stdout, createGzip(), createWriteStream(partial, { flags: "wx", mode: 0o600 }))]);
    if ((await stat(partial)).size === 0) throw new Error("Empty export rejected.");
    await rename(partial, output);
    await chmod(output, 0o600);
    console.log(`Backup created: ${output}`);
    console.log("Private snapshot: includes password hashes, session records, and stored audio. Do not publish or commit it.");
  } catch (error) {
    child.kill();
    await unlink(partial).catch(() => {});
    throw error;
  }
}
