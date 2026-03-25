import path from 'path';
import { Express, NextFunction, Request, Response } from 'express';
import { publishSubmittedJoke, QueueUnavailableError } from './rabbit';
import { readTypesCache } from './typesCache';

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

export function registerRoutes(app: Express): void {
  const sendTypes = async (res: Response): Promise<void> => {
    const types = await readTypesCache();
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

      await publishSubmittedJoke({ setup, punchline, type, submittedAt: new Date().toISOString() });
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
