export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  ADMIN_PASSPHRASE: string;
}
