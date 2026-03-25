import { Channel, ConsumeMessage } from 'amqplib';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';
import { pool } from './db';
import { publishTypeUpdateEvent } from './rabbit';

type ModeratedJokePayload = {
  setup: string;
  punchline: string;
  type: string;
  submittedAt: string;
  moderatedAt: string;
};

type TypeIdRow = RowDataPacket & {
  id: number;
  name: string;
};

type TypeNameRow = RowDataPacket & {
  name: string;
};

function parseModeratedJoke(raw: string): ModeratedJokePayload | null {
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
    typeof candidate.submittedAt !== 'string' ||
    typeof candidate.moderatedAt !== 'string'
  ) {
    return null;
  }

  return {
    setup: candidate.setup,
    punchline: candidate.punchline,
    type: candidate.type,
    submittedAt: candidate.submittedAt,
    moderatedAt: candidate.moderatedAt
  };
}

async function ensureType(connection: PoolConnection, typeName: string): Promise<{ typeId: number; isNewType: boolean; canonicalType: string }> {
  const [existingRows] = await connection.execute<TypeIdRow[]>(
    'SELECT id, name FROM types WHERE LOWER(name) = LOWER(?) LIMIT 1',
    [typeName]
  );

  if (existingRows.length > 0) {
    return { typeId: existingRows[0].id, isNewType: false, canonicalType: existingRows[0].name };
  }

  try {
    const [insertResult] = await connection.execute<ResultSetHeader>('INSERT INTO types (name) VALUES (?)', [typeName]);
    return { typeId: insertResult.insertId, isNewType: true, canonicalType: typeName };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('duplicate')) {
      throw error;
    }

    const [retryRows] = await connection.execute<TypeIdRow[]>(
      'SELECT id, name FROM types WHERE LOWER(name) = LOWER(?) LIMIT 1',
      [typeName]
    );

    if (retryRows.length === 0) {
      throw error;
    }

    return { typeId: retryRows[0].id, isNewType: false, canonicalType: retryRows[0].name };
  }
}

export async function handleMessage(channel: Channel, msg: ConsumeMessage | null): Promise<void> {
  if (!msg) {
    return;
  }

  const raw = msg.content.toString('utf8');
  const parsed = parseModeratedJoke(raw);

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

  if (Number.isNaN(Date.parse(parsed.submittedAt)) || Number.isNaN(Date.parse(parsed.moderatedAt))) {
    console.error('ETL poison message (invalid timestamps), acking:', raw);
    channel.ack(msg);
    return;
  }

  let connection: PoolConnection | null = null;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const { typeId, isNewType, canonicalType } = await ensureType(connection, trimmed.type);
    const [jokeResult] = await connection.execute<ResultSetHeader>(
      'INSERT INTO jokes (setup, punchline, type_id) VALUES (?, ?, ?)',
      [trimmed.setup, trimmed.punchline, typeId]
    );

    await connection.commit();

    if (isNewType) {
      publishTypeUpdateEvent(channel, { type: canonicalType, updatedAt: new Date().toISOString() });
      console.log(`ETL published type_update for new type: ${canonicalType}`);
    }

    console.log(`ETL inserted moderated joke ${jokeResult.insertId} (type=${canonicalType})`);
    channel.ack(msg);
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('ETL rollback failed:', rollbackError);
      }
    }

    console.error('ETL DB/transient error, requeueing message:', error);
    channel.nack(msg, false, true);
  } finally {
    connection?.release();
  }
}

export async function publishExistingTypesSnapshot(channel: Channel): Promise<void> {
  const [rows] = await pool.query<TypeNameRow[]>('SELECT name FROM types ORDER BY name');
  for (const row of rows) {
    publishTypeUpdateEvent(channel, { type: row.name, updatedAt: new Date().toISOString() });
  }
  console.log(`ETL published initial type_update snapshot for ${rows.length} type(s)`);
}
