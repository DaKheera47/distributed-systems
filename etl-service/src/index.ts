import dotenv from 'dotenv';
import { waitForDbReady } from './db';
import { handleMessage, publishExistingTypesSnapshot } from './etl';
import { initRabbit, startConsumer } from './rabbit';

dotenv.config();

async function start(): Promise<void> {
  console.log('Starting etl-service...');
  await waitForDbReady();
  const channel = await initRabbit();
  await publishExistingTypesSnapshot(channel);
  await startConsumer(handleMessage);
}

start().catch((error) => {
  console.error('Failed to start etl-service:', error);
  process.exit(1);
});
