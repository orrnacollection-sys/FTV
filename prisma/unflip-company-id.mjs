#!/usr/bin/env node
/**
 * Roll back the required-flip. Sets companyId back to nullable so
 * existing create() calls keep compiling. Run once after the flip
 * script was executed by mistake.
 */
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("./schema.prisma", import.meta.url);
const text = readFileSync(path, "utf8");
const lines = text.split(/\r?\n/);

let flipped = 0;
for (let i = 0; i < lines.length - 3; i++) {
  if (!lines[i].includes("Multi-company scope (#133)")) continue;
  const cidLine = lines[i + 2];
  const relLine = lines[i + 3];
  if (!/companyId\s+String$/.test(cidLine)) continue;
  if (!/company\s+Company\s+@relation\(/.test(relLine)) continue;
  lines[i + 2] = cidLine.replace(/String$/, "String?");
  lines[i + 3] = relLine.replace(/Company\s+@relation\(/, "Company? @relation(");
  flipped++;
}

writeFileSync(path, lines.join("\n"), "utf8");
console.log(`Reverted ${flipped} pair(s) to nullable.`);
