import { Express, NextFunction, Request, Response } from 'express';
import path from 'path';
import { readFile } from 'fs/promises';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool, query } from './db';

type TypeRow = RowDataPacket & {
  id: number;
  name: string;
};

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

export function registerRoutes(app: Express): void {
  const viewsDir = path.join(__dirname, 'views');

  app.get('/submit', (_req, res) => {
    res.sendFile(path.join(viewsDir, 'submit.html'));
  });

  app.get('/types', async (_req, res, next) => {
    try {
      const rows = await query<TypeRow[]>('SELECT name FROM types ORDER BY name');
      res.json(rows.map((row) => row.name));
    } catch (error) {
      next(error);
    }
  });

  app.post('/submit', async (req, res, next) => {
    try {
      const rawText = typeof req.body.text === 'string' ? req.body.text : '';
      const rawType = typeof req.body.type === 'string' ? req.body.type : '';
      const text = rawText.trim();
      const typeName = rawType.trim();

      if (text.length < 1) {
        res.status(400).send(htmlMessage('Validation Error', 'Joke text is required.'));
        return;
      }

      const typeRows = await query<TypeRow[]>('SELECT id, name FROM types WHERE name = ?', [typeName]);
      if (typeRows.length === 0) {
        res.status(400).send(htmlMessage('Validation Error', 'Selected type does not exist.'));
        return;
      }

      const typeId = typeRows[0].id;
      const [result] = await pool.execute<ResultSetHeader>(
        'INSERT INTO jokes (text, type_id) VALUES (?, ?)',
        [text, typeId]
      );

      const template = await readFile(path.join(viewsDir, 'success.html'), 'utf8');
      const html = template.replaceAll('{{JOKE_ID}}', String(result.insertId));
      res.send(html);
    } catch (error) {
      next(error);
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Unhandled error in submit-service:', message);
    res.status(500).send(htmlMessage('Server Error', 'Something went wrong while processing your request.'));
  });
}
