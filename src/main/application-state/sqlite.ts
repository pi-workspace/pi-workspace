export type SqliteDatabase = {
  close(): void
  exec(sql: string): void
  prepare(sql: string): {
    get(...values: unknown[]): Record<string, unknown> | undefined
    all(...values: unknown[]): Record<string, unknown>[]
    run(...values: unknown[]): void
  }
}

export type SqliteModule = {
  DatabaseSync: new (path: string) => SqliteDatabase
  backup(source: SqliteDatabase, destination: string): Promise<void>
}
