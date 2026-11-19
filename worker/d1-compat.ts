// Compile-time check (worker/tsconfig.json): the real Workers bindings fit the
// structural types lib/db uses, so code tested against the node:sqlite shim
// accepts the real D1 and R2 bindings unchanged.
import type { D1DatabaseLike, R2BucketLike } from "../lib/db/d1";

export function d1Fits(db: D1Database): D1DatabaseLike {
  return db;
}

export function r2Fits(bucket: R2Bucket): R2BucketLike {
  return bucket;
}
