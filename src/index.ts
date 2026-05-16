import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import webhookRouter from './routes/webhook';
import adminRouter from './routes/admin';
import { buildLegacyTenant, ensureHeaderRow } from './services/sheets.service';
import { logger } from './utils/logger';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// ─── Body Parsing — preserve rawBody for LINE signature verification ───────────
app.use(
  express.json({
    verify: (req: Request & { rawBody?: string }, _res: Response, buf: Buffer) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mode: process.env.SUPABASE_URL ? 'multi-tenant' : 'single-tenant',
  });
});

// ─── Routes ────────────────────────────────────────────────────────────────────

// Multi-tenant webhook: POST /webhook/:tenantId
// Legacy single-tenant: POST /webhook  (maps to tenantId = 'legacy')
app.use('/webhook', webhookRouter);

// Admin / registration panel
app.use('/', adminRouter);

// ─── Global Error Handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  logger.info(`Server listening on port ${PORT}`);
  logger.info(`Mode: ${process.env.SUPABASE_URL ? 'multi-tenant (Supabase)' : 'single-tenant (env vars)'}`);
  logger.info(`Webhook base: POST /webhook/:tenantId`);
  logger.info(`Register panel: GET /register`);

  // In single-tenant mode, verify legacy tenant's Sheets connection
  const legacy = buildLegacyTenant();
  if (legacy) {
    try {
      await ensureHeaderRow(legacy);
      logger.info('Legacy tenant Google Sheets verified ✅');
    } catch (err) {
      logger.warn('Legacy tenant Sheets not configured — skipping', { err });
    }
  }
});
