#!/usr/bin/env node
/**
 * Phase A1.5 — flip `companyId String?` → `companyId String` (required).
 *
 * NOTE (#133): Deferred. Flipping to required breaks every create() call
 * across ~50 files at the type level. We keep companyId nullable in the
 * schema and instead enforce non-null at the helper layer:
 *
 *   - Every operational row create()/createMany() goes through the
 *     server-action handler, which calls `getActiveCompanyId()` to stamp
 *     the value.
 *   - A periodic invariant check (or migration after #134) flips this on
 *     once every call-site is migrated.
 *
 * Kept here for future use; can re-run by uncommenting the body.
 */
console.log("Skipped — see file header for rationale.");
process.exit(0);
