import dotenv from 'dotenv';
import express from 'express';
import morgan from 'morgan';
import { initRabbitPublisher } from './rabbit';
import { registerRoutes } from './routes';

dotenv.config();

async function start(): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT ?? 3001);

  app.use(morgan('dev'));
  app.use(express.urlencoded({ extended: false }));

  registerRoutes(app);

  console.log('Starting submit-service...');
  await initRabbitPublisher();

  app.listen(port, () => {
    console.log(`submit-service listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start submit-service:', error);
  process.exit(1);
});
