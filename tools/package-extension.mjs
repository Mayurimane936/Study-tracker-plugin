import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "extension");
const output = path.join(source, "release");
const apiUrl = process.env.STUDYTRACK_API_URL?.replace(/\/$/, "");

if (!apiUrl) {
  throw new Error("Set STUDYTRACK_API_URL, for example https://studytrack.example.com/api");
}

const parsedApiUrl = new URL(apiUrl);
if (parsedApiUrl.protocol !== "https:") {
  throw new Error("Production extension API URL must use HTTPS.");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const entries = await readdir(source, { withFileTypes: true });
for (const entry of entries) {
  if (entry.name === "release") continue;
  await cp(
    path.join(source, entry.name),
    path.join(output, entry.name),
    { recursive: true },
  );
}

const manifestPath = path.join(output, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions = [`${parsedApiUrl.origin}${parsedApiUrl.pathname.replace(/\/$/, "")}/*`];
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  path.join(output, "deployment-config.js"),
  `globalThis.STUDYTRACK_API_URL = ${JSON.stringify(apiUrl)};\n`,
);

console.log(`Production extension packaged at ${path.relative(root, output)}`);