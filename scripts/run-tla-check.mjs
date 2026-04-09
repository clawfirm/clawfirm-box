import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = new Set(process.argv.slice(2));
const required = args.has("--required");
const repoDir = path.resolve(__dirname, "..");
const specDir = path.join(repoDir, "spec");
const specs = [
  "ADAPTER_SERVICE_STATE",
  "ADAPTER_DNS_MUTATION_STATE",
  "ADAPTER_PUBLISH_API_STATE",
  "ADAPTER_DOMAIN_RECONCILE_STATE",
  "ADAPTER_ADMIN_HEALTH_STATE",
].map((label) => ({
  label,
  cwd: specDir,
  specFile: path.join(specDir, `${label}.tla`),
  configFile: path.join(specDir, `${label}.cfg`),
}));

function resolveJarPath() {
  const explicit = process.env.TLA2TOOLS_JAR;
  if (explicit) return explicit;

  const localJar = path.join(specDir, "tla2tools.jar");
  if (existsSync(localJar)) return localJar;

  return null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (specs.some((entry) => !existsSync(entry.specFile) || !existsSync(entry.configFile))) {
  fail("Missing one or more TLA+ spec files under spec/.");
}

const jarPath = resolveJarPath();

if (!jarPath) {
  const message = [
    "Skipping box daemon TLA+ check: no tla2tools.jar configured.",
    "Set TLA2TOOLS_JAR=/absolute/path/to/tla2tools.jar or place tla2tools.jar in spec/.",
  ].join(" ");

  if (required) fail(message);

  console.log(message);
  process.exit(0);
}

for (const spec of specs) {
  console.log(`Running TLA+ check for ${spec.label}...`);

  const result = spawnSync(
    "java",
    [
      "-XX:+UseParallelGC",
      "-cp",
      jarPath,
      "tlc2.TLC",
      path.basename(spec.specFile),
      "-config",
      path.basename(spec.configFile),
    ],
    {
      cwd: spec.cwd,
      encoding: "utf8",
      stdio: "inherit",
    },
  );

  if (result.error) {
    const prefix = `Failed to execute TLC via Java for ${spec.label}.`;
    const detail = result.error.message ? ` ${result.error.message}` : "";

    if (required) fail(`${prefix}${detail}`);

    console.log(`${prefix}${detail}`);
    process.exit(0);
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.exit(0);
