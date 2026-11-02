import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/src/client", { recursive: true });
await cp("src/client", "dist/src/client", { recursive: true });
console.log("Copied dashboard assets to dist/src/client");
