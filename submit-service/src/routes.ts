import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { Express, NextFunction, Request, Response } from 'express';
import { publishSubmittedJoke, QueueUnavailableError } from './rabbit';

function htmlMessage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/sakura.css/css/sakura.css" type="text/css">
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
      <p><a href="/submit">Back to form</a></p>
    </main>
  </body>
</html>`;
}

const viewsDir = path.join(__dirname, 'views');
const cachePath = process.env.TYPES_CACHE_PATH ?? '/usr/src/data/types.json';
const typesUrl = process.env.JOKE_SERVICE_TYPES_URL ?? 'http://joke-service:3000/types';

async function saveTypesCache(types: string[]): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(types, null, 2), 'utf8');
}

async function readTypesCache(): Promise<string[] | null> {
  try {
    const raw = await readFile(cachePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
      console.warn('submit-service types cache file is invalid JSON array');
      return null;
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`submit-service types cache unavailable: ${message}`);
    return null;
  }
}

async function fetchTypesFromJokeService(): Promise<string[]> {
  const response = await fetch(typesUrl);
  if (!response.ok) {
    throw new Error(`types fetch failed with status ${response.status}`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data) || !data.every((item) => typeof item === 'string')) {
    throw new Error('types fetch returned invalid payload');
  }

  return data;
}

async function getTypesWithCacheFallback(): Promise<string[]> {
  try {
    const freshTypes = await fetchTypesFromJokeService();
    await saveTypesCache(freshTypes);
    return freshTypes;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`submit-service failed to fetch types from joke-service, using cache: ${message}`);
    const cachedTypes = await readTypesCache();
    if (cachedTypes) {
      return cachedTypes;
    }
    console.warn('submit-service returning empty type list because cache is missing');
    return [];
  }
}

export function registerRoutes(app: Express): void {
  const sendTypes = async (res: Response): Promise<void> => {
    const types = await getTypesWithCacheFallback();
    res.json(types);
  };

  app.get('/submit', (_req, res) => {
    res.sendFile(path.join(viewsDir, 'submit.html'));
  });

  app.get('/types', async (_req, res, next) => {
    try {
      await sendTypes(res);
    } catch (error) {
      next(error);
    }
  });

  app.get('/submit-types', async (_req, res, next) => {
    try {
      await sendTypes(res);
    } catch (error) {
      next(error);
    }
  });

  app.post('/submit', async (req, res, next) => {
    try {
      const setup = typeof req.body.setup === 'string' ? req.body.setup.trim() : '';
      const punchline = typeof req.body.punchline === 'string' ? req.body.punchline.trim() : '';
      const type = typeof req.body.type === 'string' ? req.body.type.trim() : '';

      if (setup.length < 1) {
        res.status(400).send(htmlMessage('Validation Error', 'Setup is required.'));
        return;
      }

      if (punchline.length < 1) {
        res.status(400).send(htmlMessage('Validation Error', 'Punchline is required.'));
        return;
      }

      if (type.length < 1) {
        res.status(400).send(htmlMessage('Validation Error', 'Type is required.'));
        return;
      }

      await publishSubmittedJoke({
        setup,
        punchline,
        type,
        submittedAt: new Date().toISOString()
      });

      res.sendFile(path.join(viewsDir, 'success.html'));
    } catch (error) {
      if (error instanceof QueueUnavailableError) {
        console.error('submit-service queue unavailable:', error.message);
        res.status(503).send(htmlMessage('Queue Unavailable', 'Submission queue unavailable. Please try again shortly.'));
        return;
      }

      next(error);
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Unhandled error in submit-service:', message);
    res.status(500).send(htmlMessage('Server Error', 'Something went wrong while processing your request.'));
  });
}
