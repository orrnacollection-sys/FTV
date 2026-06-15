import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { put } from "@vercel/blob";

const PUBLIC_DIR = path.join(process.cwd(), "public", "uploads");

const SCOPE_RE = /^[a-z][a-z0-9_-]{1,30}$/;

// MIME → safe extension (we never trust file.name).
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

/**
 * Save an uploaded file.
 *
 *  - When `BLOB_READ_WRITE_TOKEN` is set (Vercel prod / linked dev) the file
 *    goes to Vercel Blob and we return its public URL (https://*.public.blob.vercel-storage.com/...).
 *  - Otherwise the file is written to `public/uploads/<scope>/...` and we
 *    return a relative URL. Dev fallback only — Vercel's serverless FS is
 *    read-only, so prod *must* have the token set.
 *
 * Defenses (apply to both backends):
 *  - `scope` is allowlisted by regex (no path traversal).
 *  - extension is derived from MIME (we never trust file.name).
 *  - MIME is allowlisted.
 *  - Local-path destination is asserted to live under PUBLIC_DIR.
 */
export async function saveUpload(
  scope: string,
  file: File,
  opts?: { maxBytes?: number },
): Promise<string> {
  if (!SCOPE_RE.test(scope)) throw new Error("Invalid upload scope");

  const maxBytes = opts?.maxBytes ?? 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(`File too large (max ${Math.floor(maxBytes / 1024 / 1024)} MB)`);
  }

  const ext = MIME_EXT[file.type];
  if (!ext) throw new Error(`Unsupported file type: ${file.type}`);

  const id = crypto.randomBytes(12).toString("hex");
  const fileName = `${id}.${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blob = await put(`${scope}/${fileName}`, file, {
        access: "public",
        contentType: file.type,
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
      });
      return blob.url;
    } catch (e) {
      throw new Error(`Blob upload failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  // Local FS fallback (dev only).
  const dir = path.join(PUBLIC_DIR, scope);
  const dest = path.join(dir, fileName);
  const resolvedDest = path.resolve(dest);
  const resolvedRoot = path.resolve(PUBLIC_DIR);
  if (!resolvedDest.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Path escapes upload root");
  }
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(dest, buf);
  return `/uploads/${scope}/${fileName}`;
}
