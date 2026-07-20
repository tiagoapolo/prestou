import postgres, { type Sql } from "postgres";
import { config } from "./config.js";

type DbValue = string | number | boolean | Date | null;

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

const postgresConnection = postgres(config.databaseUrl, {
  max: config.databasePoolSize,
  ssl: config.databaseSsl ? "require" : false,
  prepare: false,
});

export const db: DatabaseClient = new PostgresClient(postgresConnection);
export const queryAll = db.queryAll.bind(db);
export const queryOne = db.queryOne.bind(db);
export const execute = db.execute.bind(db);

export async function withTransaction<T>(
  callback: (tx: DatabaseClient) => Promise<T>,
): Promise<T> {
  return postgresConnection.begin(async (transaction) =>
    callback(new PostgresClient(transaction as unknown as Sql)),
  ) as Promise<T>;
}

export async function closeDatabase(): Promise<void> {
  await postgresConnection.end({ timeout: 5 });
}
