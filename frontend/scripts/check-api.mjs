import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = mkdtempSync(join(tmpdir(), "caption-relay-api-"));
try {
  const target = join(directory, "api.d.ts");
  const result = spawnSync("openapi-typescript", ["../docs/generated/openapi.json", "-o", target], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("API type generation failed");
  if (readFileSync(target, "utf8") !== readFileSync("src/generated/api.d.ts", "utf8")) {
    throw new Error("API types are stale. Run npm run generate:api.");
  }
  console.log("TypeScript API types match OpenAPI");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
