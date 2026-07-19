import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import postgres, { type Sql } from "postgres";
import { config } from "./config.js";

type DbValue = SQLInputValue | Date | null;

export interface DatabaseClient {
  queryAll<T>(query: string, ...params: DbValue[]): Promise<T[]>;
  queryOne<T>(query: string, ...params: DbValue[]): Promise<T | undefined>;
  execute(query: string, ...params: DbValue[]): Promise<{ changes: number }>;
}

function pgPlaceholders(query: string): string {
  let index = 0;
  return query.replace(/\?/g, () => `$${++index}`);
}

class PostgresClient implements DatabaseClient {
  constructor(private readonly connection: Sql) {}

  async queryAll<T>(query: string, ...params: DbValue[]): Promise<T[]> {
    return (await this.connection.unsafe(
      pgPlaceholders(query),
      params as Parameters<Sql["unsafe"]>[1],
    )) as unknown as T[];
  }

  async queryOne<T>(query: string, ...params: DbValue[]): Promise<T | undefined> {
    return (await this.queryAll<T>(query, ...params))[0];
  }

  async execute(query: string, ...params: DbValue[]): Promise<{ changes: number }> {
    const result = await this.connection.unsafe(
      pgPlaceholders(query),
      params as Parameters<Sql["unsafe"]>[1],
    );
    return { changes: result.count };
  }
}

class SqliteClient implements DatabaseClient {
  constructor(readonly connection: DatabaseSync) {}

  async queryAll<T>(query: string, ...params: DbValue[]): Promise<T[]> {
    return this.connection
      .prepare(query)
      .all(...(params as SQLInputValue[])) as unknown as T[];
  }

  async queryOne<T>(query: string, ...params: DbValue[]): Promise<T | undefined> {
    return this.connection
      .prepare(query)
      .get(...(params as SQLInputValue[])) as unknown as T | undefined;
  }

  async execute(query: string, ...params: DbValue[]): Promise<{ changes: number }> {
    const result = this.connection
      .prepare(query)
      .run(...(params as SQLInputValue[]));
    return { changes: Number(result.changes) };
  }
}

let sqlite: DatabaseSync | undefined;
let pg: Sql | undefined;

if (config.databaseUrl) {
  pg = postgres(config.databaseUrl, {
    max: config.databasePoolSize,
    ssl: config.databaseSsl ? "require" : false,
    prepare: false,
  });
} else {
  mkdirSync(dirname(config.databasePath), { recursive: true });
  mkdirSync(config.uploadsDir, { recursive: true });
  sqlite = new DatabaseSync(config.databasePath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  initializeSqlite(sqlite);
}

export const databaseMode = pg ? "postgres" : "sqlite";
export const db: DatabaseClient = pg
  ? new PostgresClient(pg)
  : new SqliteClient(sqlite!);

export const queryAll = db.queryAll.bind(db);
export const queryOne = db.queryOne.bind(db);
export const execute = db.execute.bind(db);

export async function withTransaction<T>(
  callback: (tx: DatabaseClient) => Promise<T>,
): Promise<T> {
  if (pg) {
    return pg.begin(async (transaction) =>
      callback(new PostgresClient(transaction as unknown as Sql)),
    ) as Promise<T>;
  }

  sqlite!.exec("BEGIN");
  try {
    const result = await callback(db);
    sqlite!.exec("COMMIT");
    return result;
  } catch (error) {
    sqlite!.exec("ROLLBACK");
    throw error;
  }
}

export async function closeDatabase(): Promise<void> {
  if (pg) await pg.end({ timeout: 5 });
  if (sqlite?.isOpen) sqlite.close();
}

function initializeSqlite(connection: DatabaseSync): void {
  connection.exec(`
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY, auth_user_id TEXT UNIQUE, email TEXT,
  name TEXT NOT NULL, profession TEXT NOT NULL, photo_url TEXT, city TEXT,
  pix_key TEXT NOT NULL, pix_key_type TEXT NOT NULL, whatsapp TEXT NOT NULL,
  api_token TEXT UNIQUE, consent_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  name TEXT NOT NULL, whatsapp TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (provider_id, whatsapp)
);
CREATE TABLE IF NOT EXISTS charges (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  description TEXT NOT NULL, amount_cents INTEGER NOT NULL, due_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, charge_id TEXT NOT NULL REFERENCES charges(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 1, amount_cents INTEGER NOT NULL, due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'em_aberto', public_token TEXT NOT NULL UNIQUE,
  brcode TEXT NOT NULL, client_confirmed_at TEXT, comprovante_path TEXT,
  paid_at TEXT, paid_via TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_transitions (
  id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  from_status TEXT, to_status TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, provider_id TEXT, charge_id TEXT,
  payment_id TEXT, metadata TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL, kind TEXT NOT NULL,
  body TEXT NOT NULL, wa_deeplink TEXT, status TEXT NOT NULL, error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_charge ON payments(charge_id);
CREATE INDEX IF NOT EXISTS idx_charges_provider ON charges(provider_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_notifications_provider ON notifications(provider_id);
  `);
}
