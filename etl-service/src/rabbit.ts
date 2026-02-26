import amqp, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';

const rabbitUrl = process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672';
const queueName = process.env.QUEUE_NAME ?? 'SUBMITTED_JOKES';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

async function connectOnce(): Promise<Channel> {
  const nextConnection = await amqp.connect(rabbitUrl);
  const nextChannel = await nextConnection.createChannel();

  await nextChannel.assertQueue(queueName, { durable: true });
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

  console.log(`etl-service connected to RabbitMQ queue ${queueName}`);
  return nextChannel;
}

export async function startConsumer(
  onMessage: (channel: Channel, msg: ConsumeMessage | null) => Promise<void>
): Promise<void> {
  let activeChannel: Channel | null = null;

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      activeChannel = await connectOnce();
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`RabbitMQ not ready yet (attempt ${attempt}/30): ${message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (!activeChannel) {
    console.error('ETL RabbitMQ readiness check failed after 30 attempts');
    process.exit(1);
  }

  await activeChannel.consume(
    queueName,
    async (msg) => {
      try {
        await onMessage(activeChannel as Channel, msg);
      } catch (error) {
        console.error('ETL unhandled consumer error:', error);
        if (msg) {
          (activeChannel as Channel).nack(msg, false, true);
        }
      }
    },
    { noAck: false }
  );

  console.log('etl-service consumer started');
}
