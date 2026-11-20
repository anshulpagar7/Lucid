// Writes ml/schema.json from the TypeScript recording schema (single source of truth).
// Run via `npm run schema`; a vitest check fails if the two ever drift apart.
import { writeFileSync } from "node:fs";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
const { COLUMNS, CONTEXT_COLUMNS, BLENDSHAPES } = await server.ssrLoadModule("/src/study/schema.ts");
const { LABEL_COLUMNS } = await server.ssrLoadModule("/src/study/export.ts");
writeFileSync("ml/schema.json", JSON.stringify({ label_columns: LABEL_COLUMNS, context_columns: CONTEXT_COLUMNS, columns: COLUMNS, blendshapes: BLENDSHAPES }, null, 2) + "\n");
await server.close();
console.log(`[lucid] ml/schema.json written (${COLUMNS.length} columns)`);
