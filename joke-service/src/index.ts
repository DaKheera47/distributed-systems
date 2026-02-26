import dotenv from 'dotenv';
import express from 'express';
import morgan from 'morgan';
import { waitForDbReady } from './db';
import { registerRoutes } from './routes';

dotenv.config();

async function start(): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT ?? 3000);

  app.use(morgan('dev'));
  app.use(express.json());

  registerRoutes(app);

  console.log('Starting joke-service...');
  await waitForDbReady();

  app.listen(port, () => {
    console.log(`joke-service listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start joke-service:', error);
  process.exit(1);
});
