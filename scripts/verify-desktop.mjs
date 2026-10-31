// Exercise the frozen backend outside the checkout, including authenticated requests and parent EOF.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(tmpdir(), "caption-desktop-probe-"));
const runtime = join(scratch, "runtime");
await cp(join(root, ".cache/desktop/caption-relay-service"), runtime, { recursive: true });
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.includes("API_KEY") && !key.startsWith("CAPTION_RELAY_")));
const child = spawn(join(runtime, "caption-relay-service"), [], { cwd: scratch, env: environment, stdio: ["pipe", "pipe", "pipe"] });
const exited = once(child, "exit");
let errors = "";
child.stderr.on("data", data => { errors += String(data); });
const lines = createInterface({ input: child.stdout });
try {
  const readyLine = once(lines, "line", { signal: AbortSignal.timeout(30000) });
  child.stdin.write(JSON.stringify({ environment: {}, data_dir: join(scratch, "state") }) + "\n");
  const [line] = await readyLine;
  const { port, token } = JSON.parse(line);
  const origin = `http://127.0.0.1:${port}`;
  const unauthorized = await fetch(origin + "/api/session");
  assert.equal(unauthorized.status, 403);
  const login = await fetch(origin + "/_desktop/start?token=" + encodeURIComponent(token), { redirect: "manual" });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const request = (path, options = {}) => fetch(origin + path, { ...options,
    headers: { Cookie: cookie, "Content-Type": "application/json", ...options.headers }, signal: AbortSignal.timeout(10000) });
  assert.match(await (await request("/")).text(), /id="root"/);
  const created = await request("/api/source/events", { method: "POST", body: JSON.stringify({
    utterance_id: "bundle-probe", revision: 1, source_event_id: "bundle-probe-1", text: "配布物の確認です。", is_final: true,
  }) });
  assert.equal(created.status, 200);
  const caption = await created.json();
  const updated = await request("/api/captions/" + encodeURIComponent(caption.id), { method: "PATCH", body: JSON.stringify({
    text: "配布物から字幕を訂正しました。", base_revision: caption.revision, base_source_revision: caption.source_revision,
    request_id: "bundle-probe-save",
  }) });
  assert.equal(updated.status, 200);
  const published = await (await request("/api/view")).json();
  assert.equal(published.captions.at(-1).text, "配布物から字幕を訂正しました。");
  child.stdin.end();
  const [code] = await Promise.race([exited, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("Backend did not exit after parent EOF")), 10000);
    timer.unref();
  })]);
  assert.equal(code, 0, "Frozen backend failed: " + errors);
  await assert.rejects(fetch(origin + "/api/session", { signal: AbortSignal.timeout(1000) }));
  console.log(JSON.stringify({ frozen_backend: "passed", isolated_from_checkout: true, unauthorized_status: 403,
    caption_edit_and_publication: "passed", parent_eof_exit_code: code, state_files: await readdir(join(scratch, "state")) }));
} finally {
  lines.close();
  if (child.exitCode === null) { child.stdin.end(); child.kill(); await exited; }
  // Only the private directory created by this probe is removed.
  await rm(scratch, { recursive: true });
}
