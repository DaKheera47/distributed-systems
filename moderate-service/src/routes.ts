import express, { Express, NextFunction, Request, Response } from 'express';
import path from 'path';
import { approveCurrentModeration, getNextModerationItem, rejectCurrentModeration } from './rabbit';
import { readTypesCache } from './typesCache';

function wantsJson(req: Request): boolean {
  const accept = req.headers.accept ?? '';
  return accept.includes('application/json');
}

export function registerRoutes(app: Express): void {
  const publicDir = path.join(__dirname, 'public');
  app.use('/public', express.static(publicDir));

  app.get('/moderate', async (req, res, next) => {
    try {
      if (!wantsJson(req)) {
        res.sendFile(path.join(publicDir, 'moderate.html'));
        return;
      }

      const item = await getNextModerationItem();
      res.json(item);
    } catch (error) {
      next(error);
    }
  });

  const sendTypes = async (res: Response): Promise<void> => {
    res.json(await readTypesCache());
  };

  app.get('/types', async (_req, res, next) => {
    try {
      await sendTypes(res);
    } catch (error) {
      next(error);
    }
  });

  app.get('/moderate-types', async (_req, res, next) => {
    try {
      await sendTypes(res);
    } catch (error) {
      next(error);
    }
  });

  app.post('/moderated', async (req, res, next) => {
    try {
      const setup = typeof req.body.setup === 'string' ? req.body.setup : '';
      const punchline = typeof req.body.punchline === 'string' ? req.body.punchline : '';
      const type = typeof req.body.type === 'string' ? req.body.type : '';

      await approveCurrentModeration({ setup, punchline, type });
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message === 'validation') {
        res.status(400).json({ error: 'Validation error' });
        return;
      }
      if (error instanceof Error && error.message === 'no current moderation item') {
        res.status(409).json({ error: 'No current moderation item' });
        return;
      }
      next(error);
    }
  });

  app.post('/reject', async (_req, res, next) => {
    try {
      await rejectCurrentModeration();
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message === 'no current moderation item') {
        res.status(409).json({ error: 'No current moderation item' });
        return;
      }
      next(error);
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Unhandled error in moderate-service:', message);
    res.status(500).json({ error: 'Internal server error' });
  });
}
