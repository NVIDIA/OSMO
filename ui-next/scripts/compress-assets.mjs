/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Pre-compress static assets with Brotli and Gzip for production.
 *
 * This script runs after `next build` and creates .br and .gz versions
 * of CSS, JS, and other static files in .next/static/.
 *
 * Benefits:
 * - Smaller file sizes (Brotli is ~15-20% smaller than gzip)
 * - Faster serving (no runtime compression overhead)
 * - Works with any static file server (nginx, caddy, etc.)
 *
 * Usage:
 *   pnpm compress
 *
 * Your server/CDN should be configured to serve pre-compressed files:
 *   - Nginx: gzip_static on; brotli_static on;
 *   - Caddy: encode gzip zstd (serves pre-compressed automatically)
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);

// File extensions to compress
const COMPRESSIBLE_EXTENSIONS = new Set([".js", ".css", ".html", ".json", ".svg", ".txt", ".xml", ".woff2"]);

// Minimum file size to compress (bytes) - smaller files don't benefit
const MIN_SIZE = 1024;

// Directories to process
const STATIC_DIRS = [".next/static"];

/**
 * Compress a single file with Brotli and Gzip
 */
async function compressFile(filePath) {
  const content = await readFile(filePath);

  // Skip small files
  if (content.length < MIN_SIZE) {
    return { skipped: true, reason: "too small" };
  }

  const results = { original: content.length };

  // Gzip compression
  try {
    const gzipped = await gzipAsync(content, { level: 9 });
    await writeFile(`${filePath}.gz`, gzipped);
    results.gzip = gzipped.length;
    results.gzipRatio = ((1 - gzipped.length / content.length) * 100).toFixed(1);
  } catch (err) {
    console.warn(`  ⚠ Gzip failed for ${filePath}:`, err.message);
  }

  // Brotli compression (using dynamic import for Node.js compatibility)
  try {
    const { brotliCompress, constants } = await import("node:zlib");
    const brotliAsync = promisify(brotliCompress);
    const brotlied = await brotliAsync(content, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11, // Max compression
        [constants.BROTLI_PARAM_SIZE_HINT]: content.length,
      },
    });
    await writeFile(`${filePath}.br`, brotlied);
    results.brotli = brotlied.length;
    results.brotliRatio = ((1 - brotlied.length / content.length) * 100).toFixed(1);
  } catch (err) {
    console.warn(`  ⚠ Brotli failed for ${filePath}:`, err.message);
  }

  return results;
}

/**
 * Recursively find all compressible files in a directory
 */
async function findFiles(dir, files = []) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await findFiles(fullPath, files);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        // Skip already compressed files
        if (ext === ".br" || ext === ".gz") continue;

        if (COMPRESSIBLE_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (err) {
    // Directory doesn't exist yet (first build)
    if (err.code !== "ENOENT") {
      throw err;
    }
  }

  return files;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Main compression pipeline
 */
async function main() {
  console.log("\n🗜️  Compressing static assets with Brotli and Gzip...\n");

  let totalFiles = 0;
  let totalOriginal = 0;
  let totalGzip = 0;
  let totalBrotli = 0;

  for (const dir of STATIC_DIRS) {
    const files = await findFiles(dir);

    if (files.length === 0) {
      console.log(`  📁 ${dir}: No files to compress`);
      continue;
    }

    console.log(`  📁 ${dir}: ${files.length} files`);

    for (const file of files) {
      const result = await compressFile(file);

      if (result.skipped) continue;

      totalFiles++;
      totalOriginal += result.original;
      if (result.gzip) totalGzip += result.gzip;
      if (result.brotli) totalBrotli += result.brotli;
    }
  }

  if (totalFiles > 0) {
    console.log("\n📊 Compression Summary:");
    console.log(`   Files compressed: ${totalFiles}`);
    console.log(`   Original size:    ${formatBytes(totalOriginal)}`);
    console.log(`   Gzip size:        ${formatBytes(totalGzip)} (${((1 - totalGzip / totalOriginal) * 100).toFixed(1)}% smaller)`);
    console.log(`   Brotli size:      ${formatBytes(totalBrotli)} (${((1 - totalBrotli / totalOriginal) * 100).toFixed(1)}% smaller)`);
  } else {
    console.log("\n  ℹ No files needed compression");
  }

  console.log("\n✅ Done!\n");
}

main().catch((err) => {
  console.error("❌ Compression failed:", err);
  process.exit(1);
});
