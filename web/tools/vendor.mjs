import { cp, mkdir } from "node:fs/promises";
await mkdir("public/vendor/jsagrum", { recursive: true });
for (const item of ["dist", "lib", "LICENSE.md", "package.json"])
  await cp(`node_modules/jsagrum/${item}`, `public/vendor/jsagrum/${item}`, {
    recursive: true,
  });

await mkdir("public/vendor/elkjs", { recursive: true });
await cp(
  "node_modules/elkjs/lib/elk-worker.min.js",
  "public/vendor/elkjs/elk-worker.min.js",
);
// Retain runtime dependency licence texts with the distributed static assets.
import { readFile, readdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
await rm("public/notices/dependencies", { recursive: true, force: true });
const manifest = [];
for (const [location, pkg] of Object.entries(lock.packages)) {
  if (!location || pkg.dev) continue;
  const name = location.split("node_modules/").at(-1),
    directory = `public/notices/dependencies/${name.replaceAll("/", "__")}`;
  await mkdir(directory, { recursive: true });
  const files = (await readdir(location)).filter((n) =>
    /^(licen[cs]e|copying|notice|copyright)(\.|$|-)/i.test(n),
  );
  for (const file of files)
    try {
      await cp(path.join(location, file), path.join(directory, file));
    } catch (e) {
      if (e.code !== "EISDIR") throw e;
    }
  manifest.push({
    name,
    version: pkg.version,
    license: pkg.license || "See package source",
    source: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${pkg.version}.tgz`,
    notices: files,
  });
}
await writeFile(
  "public/notices/dependencies.json",
  JSON.stringify(manifest, null, 2) + "\n",
);

// Exact backend provenance documents Graphviz 16.1.0 and Expat 2.8.5.
await cp(
  "node_modules/@viz-js/viz/lib/provenance.json",
  "public/notices/graphviz/build-provenance.json",
);
