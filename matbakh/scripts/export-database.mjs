import mysql from "mysql2/promise";
import { mkdir, realpath, stat, rename, unlink, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { resolve, relative, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

export async function exportDatabase() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  const dir = resolve(process.env.BACKUP_DIR || join(root, "..", "matbakh-private-backups"));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const outputDir = await realpath(dir);
  const rel = relative(root, outputDir);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..")) throw new Error("BACKUP_DIR must be outside the project directory.");
  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, charset: "utf8mb4" });
  const output = join(outputDir, `matbakh-${new Date().toISOString().replace(/[:.]/g, "-")}.sql.gz`);
  const partial = `${output}.partial`;
  let gzip, streaming;
  const quote = name => `\`${name.replaceAll("`", "``")}\``;
  try {
    for (const [source, condition] of [["VIEWS", "TABLE_SCHEMA"], ["TRIGGERS", "TRIGGER_SCHEMA"], ["ROUTINES", "ROUTINE_SCHEMA"]]) {
      const [[row]] = await connection.query(`SELECT COUNT(*) AS total FROM information_schema.${source} WHERE ${condition}=DATABASE()`);
      if (row.total > 0) throw new Error(`This portable exporter cannot preserve ${source}; use a compatible full database client instead.`);
    }
    await connection.query("SET time_zone='+00:00'");
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    const [tables] = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
    gzip = createGzip();
    streaming = pipeline(gzip, createWriteStream(partial, { flags: "wx", mode: 0o600 }));
    // Register a rejection handler immediately so stream failures never go unhandled.
    streaming.catch(() => {});
    const emit = async text => {
      if (!gzip.write(text)) await once(gzip, "drain");
    };
    const sqlValue = value => {
      if (value == null) return "NULL";
      if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
      if (typeof value === "object") return connection.escape(JSON.stringify(value));
      return connection.escape(value);
    };
    await emit("-- Private Matbakh SQL snapshot. Includes credential hashes and session records.\n-- Review before restoring: DROP TABLE statements replace target tables.\nSET NAMES utf8mb4;\nSET time_zone='+00:00';\nSET sql_mode='';\nSET foreign_key_checks=0;\n");
    const counts = {};
    const schemaHashes = {};
    for (const table of tables) {
      const name = table.name;
      const [[definition]] = await connection.query(`SHOW CREATE TABLE ${quote(name)}`);
      const ddl = definition["Create Table"];
      schemaHashes[name] = createHash("sha256").update(ddl).digest("hex");
      await emit(`\n-- Table ${name}\nDROP TABLE IF EXISTS ${quote(name)};\n${ddl};\n`);
      const [keys] = await connection.query(`SHOW KEYS FROM ${quote(name)} WHERE Key_name='PRIMARY'`);
      if (!keys.length) throw new Error(`Stable export requires a primary key for ${name}.`);
      const order = keys.sort((a, b) => a.Seq_in_index - b.Seq_in_index).map(key => quote(key.Column_name)).join(",");
      let offset = 0;
      while (true) {
        const [rows, fields] = await connection.query(`SELECT * FROM ${quote(name)} ORDER BY ${order} LIMIT 100 OFFSET ${offset}`);
        if (!rows.length) break;
        const columns = fields.map(field => field.name);
        // Write one row per INSERT to avoid packet limits when an audio BLOB is large.
        for (const row of rows) {
          await emit(`INSERT INTO ${quote(name)} (${columns.map(quote).join(",")}) VALUES (${columns.map(column => sqlValue(row[column])).join(",")});\n`);
        }
        offset += rows.length;
      }
      counts[name] = offset;
      console.log(`Exported ${name}: ${offset} rows`);
    }
    // Reject schema changes during the export rather than delivering a mixed schema.
    const [finalTables] = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
    if (JSON.stringify(finalTables.map(row => row.name)) !== JSON.stringify(tables.map(row => row.name))) throw new Error("Schema changed during export; retry during a maintenance window.");
    for (const table of tables) {
      const [[definition]] = await connection.query(`SHOW CREATE TABLE ${quote(table.name)}`);
      if (createHash("sha256").update(definition["Create Table"]).digest("hex") !== schemaHashes[table.name]) throw new Error("Schema changed during export; retry during a maintenance window.");
    }
    await emit("\nSET foreign_key_checks=1;\n-- Export complete.\n");
    gzip.end();
    await streaming;
    await connection.commit();
    const info = await stat(partial);
    if (!info.size) throw new Error("Empty snapshot rejected.");
    await rename(partial, output);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(output)) hash.update(chunk);
    const manifest = `${output}.manifest.json`;
    await writeFile(manifest, `${JSON.stringify({ format: "mysql-sql-gzip", generatedAt: new Date().toISOString(), consistentSnapshot: true, file: output.split(sep).pop(), bytes: info.size, sha256: hash.digest("hex"), counts, schemaHashes }, null, 2)}\n`, { mode: 0o600 });
    console.log(`Backup created: ${output}`);
    console.log(`Manifest created: ${manifest}`);
    console.log("Keep both files private; external object-storage files need a separate export.");
    return { output, manifest };
  } catch (error) {
    gzip?.destroy();
    await streaming?.catch(() => {});
    await connection.rollback().catch(() => {});
    await unlink(partial).catch(() => {});
    throw new Error(`Portable database export failed; no partial SQL file is considered a valid backup. ${error instanceof Error ? error.message : ""}`);
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await exportDatabase();
}
