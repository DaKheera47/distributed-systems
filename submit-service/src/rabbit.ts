import amqp, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { upsertTypeInCache } from './typesCache';

export type SubmittedJokePayload = {
  setup: string;
  punchline: string;
  type: string;
  submittedAt: string;
};

type TypeUpdateEvent = {
  type: string;
  updatedAt: string;
};

export class QueueUnavailableError extends Error {}

let connection: ChannelModel | null = null;
let publishChannel: Channel | null = null;

const rabbitUrl = process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672';
const submittedQueue = process.env.SUBMITTED_QUEUE ?? 'SUBMITTED_JOKES';
const typeUpdateExchange = process.env.TYPE_UPDATE_EXCHANGE ?? 'type_update';
const typeUpdateQueue = process.env.TYPE_UPDATE_QUEUE ?? 'sub_type_update';

function parseTypeUpdateEvent(msg: ConsumeMessage): TypeUpdateEvent | null {
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
  const nextPublishChannel = await nextConnection.createChannel();
  const typeUpdateChannel = await nextConnection.createChannel();

  await nextPublishChannel.assertQueue(submittedQueue, { durable: true });
  await nextPublishChannel.assertExchange(typeUpdateExchange, 'fanout', { durable: true });

  await typeUpdateChannel.assertExchange(typeUpdateExchange, 'fanout', { durable: true });
  await typeUpdateChannel.assertQueue(typeUpdateQueue, { durable: true });
  await typeUpdateChannel.bindQueue(typeUpdateQueue, typeUpdateExchange, '');
  await typeUpdateChannel.consume(
    typeUpdateQueue,
    async (msg) => {
      if (!msg) {
        return;
      }

      const event = parseTypeUpdateEvent(msg);
      if (!event) {
        console.error('submit-service invalid type_update event, acking poison message');
        typeUpdateChannel.ack(msg);
        return;
      }

      try {
        await upsertTypeInCache(event.type);
        typeUpdateChannel.ack(msg);
      } catch (error) {
        console.error('submit-service failed to update types cache from event, requeueing:', error);
        typeUpdateChannel.nack(msg, false, true);
      }
    },
    { noAck: false }
  );

  nextConnection.on('error', (error) => {
    console.error('submit-service RabbitMQ connection error:', error.message);
  });

  nextConnection.on('close', () => {
    console.error('submit-service RabbitMQ connection closed');
    connection = null;
    publishChannel = null;
  });

  connection = nextConnection;
  publishChannel = nextPublishChannel;

  console.log(`submit-service connected to RabbitMQ; queue=${submittedQueue}, type_update_queue=${typeUpdateQueue}`);
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

  console.error('RabbitMQ readiness check failed after 30 attempts');
  process.exit(1);
}

export async function publishSubmittedJoke(payload: SubmittedJokePayload): Promise<void> {
  if (!publishChannel) {
    throw new QueueUnavailableError('queue unavailable');
  }

  try {
    const body = Buffer.from(JSON.stringify(payload));
    const ok = publishChannel.sendToQueue(submittedQueue, body, { persistent: true });
    if (!ok) {
      console.log('RabbitMQ channel backpressure signalled while publishing');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new QueueUnavailableError(message);
  }
}
