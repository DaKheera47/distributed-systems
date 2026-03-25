import dotenv from 'dotenv';
import express from 'express';
import morgan from 'morgan';
import { initRabbit } from './rabbit';
import { registerRoutes } from './routes';

dotenv.config();

async function start(): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT ?? 3002);

  app.use(morgan('dev'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  registerRoutes(app);

  console.log('Starting moderate-service...');
  await initRabbit();

  app.listen(port, () => {
    console.log(`moderate-service listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start moderate-service:', error);
  process.exit(1);
});
