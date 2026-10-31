import "dotenv/config";
import { open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapFirstManager } from "../server/staff";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--output" || !path.isAbsolute(args[1])) {
    throw new Error("Usage: pnpm bootstrap:manager --output /absolute/private-directory/manager-credentials.json");
  }
  const projectRoot = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  const parent = await realpath(path.dirname(args[1]));
  const target = path.join(parent, path.basename(args[1]));
  const relative = path.relative(projectRoot, target);
  if (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) {
    throw new Error("The credentials file must be outside the project directory.");
  }
  // Reserve an owner-only file first. Never overwrite existing credentials.
  const file = await open(target, "wx", 0o600);
  let accountCreated = false;
  try {
    const credentials = await bootstrapFirstManager();
    accountCreated = true;
    await file.writeFile(`${JSON.stringify(credentials, null, 2)}\n`, "utf8");
    await file.sync();
  } catch (error) {
    await file.close();
    if (!accountCreated) await unlink(target);
    throw error;
  }
  await file.close();
  console.info("First manager created. Credentials saved to the specified private file; change the temporary password at first login.");
}

main().then(() => process.exit(0)).catch(() => {
  // Do not forward database errors or credentials to shared logs.
  console.error("Manager initialization failed. Verify --output points to a new private file outside the project and that staff accounts do not already exist. Existing accounts are never reset.");
  process.exit(1);
});
