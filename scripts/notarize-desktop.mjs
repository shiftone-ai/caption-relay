// Keep Apple's asynchronous submission separate from local packaging and ticket stapling.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readSync, closeSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const help = `Usage:
  node scripts/notarize-desktop.mjs check APP
  node scripts/notarize-desktop.mjs prepare APP OUTPUT_DIRECTORY
  node scripts/notarize-desktop.mjs submit OUTPUT_DIRECTORY KEYCHAIN_PROFILE
  node scripts/notarize-desktop.mjs finish OUTPUT_DIRECTORY KEYCHAIN_PROFILE

prepare creates an isolated signed app and an upload ZIP in a new directory.
submit records Apple's submission ID without waiting or uploading a second time.
finish checks the status, staples an Accepted ticket, and creates the distribution ZIP.
Credentials stay in the notarytool Keychain profile. This script never publishes a release.`;

function run(command, args) {
  const result = execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
  return result;
}

const machoMagic = new Set(["feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"]);

function binaries(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return binaries(path);
    if (!entry.isFile()) return [];
    const descriptor = openSync(path, "r");
    const magic = Buffer.alloc(4);
    try { readSync(descriptor, magic, 0, 4, 0); }
    finally { closeSync(descriptor); }
    return machoMagic.has(magic.toString("hex")) ? [path] : [];
  });
}

function inspect(path) {
  // spawnSync exposes stderr on success, unlike execFileSync's return value.
  const output = spawnSync("/usr/bin/codesign", ["-dvvv", path], { encoding: "utf8" });
  if (output.status !== 0) throw new Error(`Cannot inspect signature: ${path}\n${output.stderr}`);
  return output.stderr;
}

function check(app, expectedTeam) {
  if (!app.endsWith(".app")) throw new Error("Expected a macOS .app bundle.");
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  const metadata = inspect(app);
  const team = /^TeamIdentifier=(.+)$/m.exec(metadata)?.[1];
  if (!team || team === "not set" || (expectedTeam && team !== expectedTeam)) throw new Error("Unexpected signing team.");
  const paths = [app, ...binaries(app)];
  for (const path of paths) {
    const signed = inspect(path);
    if (!signed.includes("Authority=Developer ID Application:") || !signed.includes(`TeamIdentifier=${team}\n`)
      || !/^Timestamp=.+$/m.test(signed) || !/^CodeDirectory=?.*\(runtime\)/m.test(signed)) {
      throw new Error(`Developer ID, timestamp, or hardened runtime missing: ${path}`);
    }
  }
  return { team, machOBinaries: paths.length - 1 };
}

function hash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function save(path, value) { writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" }); }
function load(path) { return JSON.parse(readFileSync(path, "utf8")); }
function archive(app, destination) { run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, destination]); }

function main() {
  const [operation, input, argument, ...extra] = process.argv.slice(2);
  if (operation === "--help" || operation === "-h") { console.log(help); return; }
  if (process.platform !== "darwin") throw new Error("macOS is required.");
  if (!input || extra.length || !["check", "prepare", "submit", "finish"].includes(operation)
    || (operation === "check" ? Boolean(argument) : !argument)) throw new Error(help);
  const path = resolve(input);
  if (operation === "check") { console.log(JSON.stringify(check(path))); return; }
  if (operation === "prepare") {
    const result = check(path);
    const output = resolve(argument);
    mkdirSync(output); // Refuse to replace an existing package or user files.
    const app = join(output, basename(path));
    run("/usr/bin/ditto", [path, app]);
    check(app, result.team);
    const zip = join(output, "notarization.zip");
    archive(app, zip);
    save(join(output, "package.json"), { app: basename(app), team: result.team, sha256: hash(zip) });
    console.log(JSON.stringify({ prepared: output, ...result, notarized: false }));
    return;
  }
  const manifest = load(join(path, "package.json"));
  const app = join(path, manifest.app);
  const zip = join(path, "notarization.zip");
  check(app, manifest.team);
  if (hash(zip) !== manifest.sha256) throw new Error("The submission archive has changed. Prepare a new package.");
  const submissionPath = join(path, "submission.json");
  const auth = ["--keychain-profile", argument];
  if (operation === "submit") {
    if (!existsSync(submissionPath)) {
      const submission = JSON.parse(run("/usr/bin/xcrun", ["notarytool", "submit", zip, ...auth, "--output-format", "json", "--no-wait"]));
      save(submissionPath, submission);
    }
    console.log(JSON.stringify(load(submissionPath)));
    return;
  }
  const { id } = load(submissionPath);
  const info = JSON.parse(run("/usr/bin/xcrun", ["notarytool", "info", id, ...auth, "--output-format", "json"]));
  console.log(JSON.stringify(info));
  if (info.status === "In Progress") return;
  const log = run("/usr/bin/xcrun", ["notarytool", "log", id, ...auth]);
  writeFileSync(join(path, "notary-log.json"), log);
  if (info.status !== "Accepted") throw new Error("Notarization failed. Read notary-log.json before submitting again.");
  run("/usr/bin/xcrun", ["stapler", "staple", app]);
  run("/usr/bin/xcrun", ["stapler", "validate", app]);
  check(app, manifest.team);
  const assessment = spawnSync("/usr/sbin/spctl", ["--assess", "--type", "execute", "-vv", app], { encoding: "utf8" });
  if (assessment.status !== 0 || !assessment.stderr.includes("source=Notarized Developer ID")) {
    throw new Error(`Gatekeeper did not accept the notarized app: ${assessment.stderr}`);
  }
  const distribution = join(path, "Caption-Relay-macos.zip");
  archive(app, distribution);
  const result = { submissionId: id, team: manifest.team, status: info.status, stapled: true,
    gatekeeper: assessment.stderr.trim(), zip: basename(distribution), sha256: hash(distribution) };
  writeFileSync(join(path, "verification.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
}

try { main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
