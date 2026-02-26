import amqp, { Channel, ChannelModel } from 'amqplib';

export type SubmittedJokePayload = {
  setup: string;
  punchline: string;
  type: string;
  submittedAt: string;
};

export class QueueUnavailableError extends Error {}

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

const rabbitUrl = process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672';
const queueName = process.env.QUEUE_NAME ?? 'SUBMITTED_JOKES';

async function connectOnce(): Promise<void> {
  const nextConnection = await amqp.connect(rabbitUrl);
  const nextChannel = await nextConnection.createChannel();
  await nextChannel.assertQueue(queueName, { durable: true });

  nextConnection.on('error', (error) => {
    console.error('submit-service RabbitMQ connection error:', error.message);
  });

  nextConnection.on('close', () => {
    console.error('submit-service RabbitMQ connection closed');
    connection = null;
    channel = null;
  });

  connection = nextConnection;
  channel = nextChannel;

  console.log(`submit-service connected to RabbitMQ queue ${queueName}`);
}

export async function initRabbitPublisher(): Promise<void> {
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
  if (!channel) {
    throw new QueueUnavailableError('queue unavailable');
  }

  try {
    const body = Buffer.from(JSON.stringify(payload));
    const ok = channel.sendToQueue(queueName, body, { persistent: true });
    if (!ok) {
      console.log('RabbitMQ channel backpressure signalled while publishing');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new QueueUnavailableError(message);
  }
}
