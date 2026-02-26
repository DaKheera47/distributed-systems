import { Channel, ConsumeMessage } from 'amqplib';
import { ResultSetHeader } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';
import { pool } from './db';

type SubmittedJokePayload = {
  setup: string;
  punchline: string;
  type: string;
  submittedAt: string;
};

function parseSubmittedJoke(raw: string): SubmittedJokePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.setup !== 'string' ||
    typeof candidate.punchline !== 'string' ||
    typeof candidate.type !== 'string' ||
    typeof candidate.submittedAt !== 'string'
  ) {
    return null;
  }

  return {
    setup: candidate.setup,
    punchline: candidate.punchline,
    type: candidate.type,
    submittedAt: candidate.submittedAt
  };
}

async function insertJoke(connection: PoolConnection, payload: SubmittedJokePayload): Promise<number> {
  const setup = payload.setup.trim();
  const punchline = payload.punchline.trim();
  const type = payload.type.trim();

  if (setup.length < 1 || punchline.length < 1 || type.length < 1) {
    throw new Error('validation');
  }

  const [typeResult] = await connection.execute<ResultSetHeader>(
    'INSERT INTO types (name) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), name = name',
    [type]
  );

  const typeId = typeResult.insertId;
  const [jokeResult] = await connection.execute<ResultSetHeader>(
    'INSERT INTO jokes (setup, punchline, type_id) VALUES (?, ?, ?)',
    [setup, punchline, typeId]
  );

  return jokeResult.insertId;
}

export async function handleMessage(channel: Channel, msg: ConsumeMessage | null): Promise<void> {
  if (!msg) {
    return;
  }

  const raw = msg.content.toString('utf8');
  const parsed = parseSubmittedJoke(raw);

  if (!parsed) {
    console.error('ETL poison message (invalid JSON or shape), acking:', raw);
    channel.ack(msg);
    return;
  }

  const trimmed = {
    ...parsed,
    setup: parsed.setup.trim(),
    punchline: parsed.punchline.trim(),
    type: parsed.type.trim()
  };

  if (!trimmed.setup || !trimmed.punchline || !trimmed.type) {
    console.error('ETL poison message (empty required field), acking:', raw);
    channel.ack(msg);
    return;
  }

  if (Number.isNaN(Date.parse(parsed.submittedAt))) {
    console.error('ETL poison message (invalid submittedAt), acking:', raw);
    channel.ack(msg);
    return;
  }

  let connection: PoolConnection | null = null;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const jokeId = await insertJoke(connection, trimmed);
    await connection.commit();
    console.log(`ETL inserted joke ${jokeId} (type=${trimmed.type})`);
    channel.ack(msg);
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('ETL rollback failed:', rollbackError);
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message === 'validation') {
      console.error('ETL validation failed after transform, acking poison message');
      channel.ack(msg);
      return;
    }

    console.error('ETL DB/transient error, requeueing message:', message);
    channel.nack(msg, false, true);
  } finally {
    connection?.release();
  }
}
