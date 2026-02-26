import { RowDataPacket } from 'mysql2';
import { createPool, Pool } from 'mysql2/promise';

const host = process.env.DB_HOST ?? 'localhost';
const port = Number(process.env.DB_PORT ?? 3306);
const user = process.env.DB_USER ?? 'root';
const password = process.env.DB_PASSWORD ?? '';
const database = process.env.DB_NAME ?? 'jokesdb';

export const pool: Pool = createPool({
  host,
  port,
  user,
  password,
  database,
  connectionLimit: 10,
  waitForConnections: true
});

export async function waitForDbReady(): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      console.log(`DB ready after ${attempt} attempt(s)`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`DB not ready yet (attempt ${attempt}/30): ${message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.error('Database readiness check failed after 30 attempts');
  process.exit(1);
}

export async function query<T extends RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> {
  const [rows] = await pool.query(sql, params);
  return rows as T;
}
