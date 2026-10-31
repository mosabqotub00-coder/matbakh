import "dotenv/config";

async function main() {
  if (process.env.DEPLOYMENT_MODE !== "standalone")
    throw new Error("Standalone mode is required.");
  const token = process.env.MAINTENANCE_TOKEN ?? "";
  if (token.length < 32)
    throw new Error("Set a strong server-only MAINTENANCE_TOKEN first.");
  const target =
    process.env.DEADLINE_CHECK_URL ??
    `http://127.0.0.1:${process.env.PORT || "3000"}/api/maintenance/deadlines`;
  const url = new URL(target);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "app"].includes(url.hostname)
    )
  )
    throw new Error("Use HTTPS or loopback for the maintenance request.");
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Deadline check returned HTTP ${response.status}.`);
  const result = await response.json();
  if (result.ok !== true)
    throw new Error("Deadline check did not report success.");
  console.log(
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      checked: result.checked,
      emitted: result.emitted,
    })
  );
}
main().catch(error => {
  console.error(
    error instanceof Error ? error.message : "Deadline check failed."
  );
  process.exitCode = 1;
});
