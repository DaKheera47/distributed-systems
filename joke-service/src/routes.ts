import { Express, NextFunction, Request, Response } from 'express';
import path from 'path';
import { RowDataPacket } from 'mysql2';
import { query } from './db';

type JokeRow = RowDataPacket & {
  id: number;
  text: string;
  type: string;
};

type TypeRow = RowDataPacket & {
  name: string;
};

export function registerRoutes(app: Express): void {
  const viewsDir = path.join(__dirname, 'views');

  app.get('/', (_req, res) => {
    res.sendFile(path.join(viewsDir, 'index.html'));
  });

  app.get('/random', async (_req, res, next) => {
    try {
      const rows = await query<JokeRow[]>(
        'SELECT j.id, j.text, t.name AS type FROM jokes j JOIN types t ON j.type_id=t.id ORDER BY RAND() LIMIT 1'
      );

      if (rows.length === 0) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      const joke = rows[0];
      res.json({ id: joke.id, text: joke.text, type: joke.type });
    } catch (error) {
      next(error);
    }
  });

  app.get('/joke/:id', async (req, res, next) => {
    try {
      const jokeId = Number(req.params.id);
      if (!Number.isInteger(jokeId) || jokeId < 1) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      const rows = await query<JokeRow[]>(
        'SELECT j.id, j.text, t.name AS type FROM jokes j JOIN types t ON j.type_id=t.id WHERE j.id=?',
        [jokeId]
      );

      if (rows.length === 0) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      const joke = rows[0];
      res.json({ id: joke.id, text: joke.text, type: joke.type });
    } catch (error) {
      next(error);
    }
  });

  app.get('/types', async (_req, res, next) => {
    try {
      const rows = await query<TypeRow[]>('SELECT name FROM types ORDER BY name');
      res.json(rows.map((row) => row.name));
    } catch (error) {
      next(error);
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Unhandled error in joke-service:', message);
    res.status(500).json({ error: 'Internal server error' });
  });
}
