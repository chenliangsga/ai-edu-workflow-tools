#!/usr/bin/env node
// 用新算法重做 output/uploads 下所有已存在的 *-clean.png。
// 用法：node scripts/re-enhance-uploads.mjs [--dry]

import { readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const dry = process.argv.includes("--dry");
const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const uploadDir = join(rootDir, "output", "uploads");

async function enhance(buffer) {
  return sharp(buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .trim({ background: "#ffffff", threshold: 18 })
    .normalize()
    .linear(1.6, -60)
    .modulate({ brightness: 1.08, saturation: 0.45 })
    .sharpen({ sigma: 0.8, m1: 0.9, m2: 1.4 })
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toBuffer();
}

async function findOriginal(fileId) {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const path = join(uploadDir, `${fileId}${ext}`);
    if (existsSync(path)) return path;
  }
  return null;
}

async function main() {
  const all = await readdir(uploadDir);
  const cleanFiles = all.filter((name) => name.endsWith("-clean.png"));
  let done = 0, skip = 0, fail = 0;
  for (const name of cleanFiles) {
    const fileId = name.replace(/-clean\.png$/, "");
    const originalPath = await findOriginal(fileId);
    if (!originalPath) {
      console.log(`SKIP ${name}: original not found`);
      skip++;
      continue;
    }
    try {
      const buffer = await readFile(originalPath);
      const enhanced = await enhance(buffer);
      const cleanPath = join(uploadDir, name);
      if (dry) {
        console.log(`DRY  ${name}: would rewrite ${enhanced.length} bytes (was ${(await readFile(cleanPath)).length})`);
      } else {
        // 备份旧版（仅首次）
        const bakPath = `${cleanPath}.bak`;
        if (!existsSync(bakPath)) await copyFile(cleanPath, bakPath);
        await writeFile(cleanPath, enhanced);
        console.log(`OK   ${name}: ${enhanced.length} bytes`);
      }
      done++;
    } catch (error) {
      console.log(`FAIL ${name}: ${error.message}`);
      fail++;
    }
  }
  console.log(`\nDone: ${done} processed, ${skip} skipped, ${fail} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
