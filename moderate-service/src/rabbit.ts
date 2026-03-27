import amqp, { Channel, ChannelModel, ConsumeMessage, Message } from 'amqplib';
import { upsertTypeInCache } from './typesCache';

export type SubmittedJokePayload = {
  setup: string;
  punchline: string;
  type: string;
  submittedAt: string;
};

export type ModeratedJokePayload = SubmittedJokePayload & {
  moderatedAt: string;
};

export type ModerationItemResponse =
  | { hasItem: false }
  | ({ hasItem: true; deliveryTag: number } & SubmittedJokePayload);

let connection: ChannelModel | null = null;
let workChannel: Channel | null = null;
let heldMessage: Message | null = null;
let heldPayload: SubmittedJokePayload | null = null;

const rabbitUrl = process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672';
const submittedQueue = process.env.SUBMITTED_QUEUE ?? 'SUBMITTED_JOKES';
const moderatedQueue = process.env.MODERATED_QUEUE ?? 'MODERATED_JOKES';
const typeUpdateExchange = process.env.TYPE_UPDATE_EXCHANGE ?? 'type_update';
const typeUpdateQueue = process.env.TYPE_UPDATE_QUEUE ?? 'mod_type_update';

function parseSubmittedPayload(msg: Message): SubmittedJokePayload | null {
  try {
    const parsed: unknown = JSON.parse(msg.content.toString('utf8'));
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
  } catch {
    return null;
  }
}

function parseTypeUpdate(msg: Message): { type: string; updatedAt: string } | null {
  try {
    const parsed: unknown = JSON.parse(msg.content.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.type !== 'string' || typeof candidate.updatedAt !== 'string') {
      return null;
    }
    if (Number.isNaN(Date.parse(candidate.updatedAt))) {
      return null;
    }
    return { type: candidate.type, updatedAt: candidate.updatedAt };
  } catch {
    return null;
  }
}

async function connectOnce(): Promise<void> {
  const nextConnection = await amqp.connect(rabbitUrl);
  const nextWorkChannel = await nextConnection.createChannel();
  const typeUpdateChannel = await nextConnection.createChannel();

  await nextWorkChannel.assertQueue(submittedQueue, { durable: true });
  await nextWorkChannel.assertQueue(moderatedQueue, { durable: true });
  await nextWorkChannel.assertExchange(typeUpdateExchange, 'fanout', { durable: true });

  await typeUpdateChannel.assertExchange(typeUpdateExchange, 'fanout', { durable: true });
  await typeUpdateChannel.assertQueue(typeUpdateQueue, { durable: true });
  await typeUpdateChannel.bindQueue(typeUpdateQueue, typeUpdateExchange, '');
  await typeUpdateChannel.consume(
    typeUpdateQueue,
    async (msg) => {
      if (!msg) {
        return;
      }

      const event = parseTypeUpdate(msg);
      if (!event) {
        console.error('moderate-service invalid type_update event, acking poison message');
        typeUpdateChannel.ack(msg);
        return;
      }

      try {
        await upsertTypeInCache(event.type);
        typeUpdateChannel.ack(msg);
      } catch (error) {
        console.error('moderate-service failed to update type cache from event, requeueing:', error);
        typeUpdateChannel.nack(msg, false, true);
      }
    },
    { noAck: false }
  );

  nextConnection.on('error', (error) => {
    console.error('moderate-service RabbitMQ connection error:', error.message);
  });

  nextConnection.on('close', () => {
    console.error('moderate-service RabbitMQ connection closed');
    connection = null;
    workChannel = null;
    heldMessage = null;
    heldPayload = null;
  });

  connection = nextConnection;
  workChannel = nextWorkChannel;
  console.log(`moderate-service connected to RabbitMQ; submitted=${submittedQueue}, moderated=${moderatedQueue}`);
}

export async function initRabbit(): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await connectOnce();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`RabbitMQ not ready yet (attempt ${attempt}/30): ${message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.error('moderate-service RabbitMQ readiness check failed after 30 attempts');
  process.exit(1);
}

export async function getNextModerationItem(): Promise<ModerationItemResponse> {
  if (heldMessage && heldPayload) {
    return { hasItem: true, deliveryTag: heldMessage.fields.deliveryTag, ...heldPayload };
  }

  if (!workChannel) {
    throw new Error('moderation queue unavailable');
  }

  while (true) {
    const msg = await workChannel.get(submittedQueue, { noAck: false });
    if (!msg) {
      return { hasItem: false };
    }

    const payload = parseSubmittedPayload(msg);
    if (!payload) {
      console.error('moderate-service found poison message in submitted queue, acking');
      workChannel.ack(msg);
      continue;
    }

    heldMessage = msg;
    heldPayload = {
      setup: payload.setup.trim(),
      punchline: payload.punchline.trim(),
      type: payload.type.trim(),
      submittedAt: payload.submittedAt
    };

    return { hasItem: true, deliveryTag: msg.fields.deliveryTag, ...heldPayload };
  }
}

export async function approveCurrentModeration(input: {
  setup: string;
  punchline: string;
  type: string;
}): Promise<void> {
  if (!workChannel || !heldMessage || !heldPayload) {
    throw new Error('no current moderation item');
  }

  const setup = input.setup.trim();
  const punchline = input.punchline.trim();
  const type = input.type.trim();

  if (!setup || !punchline || !type) {
    throw new Error('validation');
  }

  const moderatedPayload: ModeratedJokePayload = {
    setup,
    punchline,
    type,
    submittedAt: heldPayload.submittedAt,
    moderatedAt: new Date().toISOString()
  };

  const ok = workChannel.sendToQueue(moderatedQueue, Buffer.from(JSON.stringify(moderatedPayload)), { persistent: true });
  if (!ok) {
    console.log('moderate-service channel backpressure signalled while publishing moderated joke');
  }

  workChannel.ack(heldMessage);
  heldMessage = null;
  heldPayload = null;
}

export async function rejectCurrentModeration(): Promise<void> {
  if (!workChannel || !heldMessage) {
    throw new Error('no current moderation item');
  }

  workChannel.ack(heldMessage);
  heldMessage = null;
  heldPayload = null;
}
