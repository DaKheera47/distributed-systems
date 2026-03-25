import amqp, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';

const rabbitUrl = process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672';
const moderatedQueue = process.env.MODERATED_QUEUE ?? 'MODERATED_JOKES';
const typeUpdateExchange = process.env.TYPE_UPDATE_EXCHANGE ?? 'type_update';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

export type TypeUpdateEvent = {
  type: string;
  updatedAt: string;
};

async function connectOnce(): Promise<Channel> {
  const nextConnection = await amqp.connect(rabbitUrl);
  const nextChannel = await nextConnection.createChannel();

  await nextChannel.assertQueue(moderatedQueue, { durable: true });
  await nextChannel.assertExchange(typeUpdateExchange, 'fanout', { durable: true });
  await nextChannel.prefetch(10);

  nextConnection.on('error', (error) => {
    console.error('etl-service RabbitMQ connection error:', error.message);
  });

  nextConnection.on('close', () => {
    console.error('etl-service RabbitMQ connection closed');
    process.exit(1);
  });

  connection = nextConnection;
  channel = nextChannel;

  console.log(`etl-service connected to RabbitMQ; moderated_queue=${moderatedQueue}, type_update_exchange=${typeUpdateExchange}`);
  return nextChannel;
}

export async function initRabbit(): Promise<Channel> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      return await connectOnce();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`RabbitMQ not ready yet (attempt ${attempt}/30): ${message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.error('ETL RabbitMQ readiness check failed after 30 attempts');
  process.exit(1);
}

export async function startConsumer(
  onMessage: (channel: Channel, msg: ConsumeMessage | null) => Promise<void>
): Promise<void> {
  const activeChannel = channel ?? (await initRabbit());

  await activeChannel.consume(
    moderatedQueue,
    async (msg) => {
      try {
        await onMessage(activeChannel, msg);
      } catch (error) {
        console.error('ETL unhandled consumer error:', error);
        if (msg) {
          activeChannel.nack(msg, false, true);
        }
      }
    },
    { noAck: false }
  );

  console.log('etl-service consumer started');
}

export function publishTypeUpdateEvent(activeChannel: Channel, event: TypeUpdateEvent): void {
  const payload = Buffer.from(JSON.stringify(event));
  activeChannel.publish(typeUpdateExchange, '', payload, { persistent: true });
}
