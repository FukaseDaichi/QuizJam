export interface Env {
  DB: D1Database;
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  ADMIN_PASSPHRASE: string;
}
