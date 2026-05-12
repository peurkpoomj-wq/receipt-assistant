import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import webhookRouter from './routes/webhook';
import { ensureHeaderRow } from './services/sheets.service';
import { initRichMenu } from './services/richmenu.service';
import { initScheduler } from './services/scheduler.service';
import { logger } from './utils/logger';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

app.use(
  express.json({
    verify: (req: Request & { rawBody?: string }, _res: Response, buf: Buffer) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/webhook', webhookRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, async () => {
  logger.info(`Server listening on port ${PORT}`);
  logger.info('Webhook endpoint: POST /webhook');

  await Promise.allSettled([
    ensureHeaderRow()
      .then(() => logger.info('Google Sheets header row verified'))
      .catch(() => logger.warn('Google Sheets not configured yet — skipping header check')),

    initRichMenu(),

    Promise.resolve().then(() => initScheduler()),
  ]);
});
