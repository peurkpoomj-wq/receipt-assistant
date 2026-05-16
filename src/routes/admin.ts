/**
 * Admin routes — tenant registration & management
 * Protected by ADMIN_SECRET env var
 */
import { Router, Request, Response } from 'express';
import { createTenant, getAllActiveTenants, updateTenant } from '../db/tenants.repo';
import { ensureHeaderRow } from '../services/sheets.service';
import { DEFAULT_TOUR_GROUPS, Tenant } from '../types';
import { logger } from '../utils/logger';

const router = Router();

const WEBHOOK_BASE =
  process.env.WEBHOOK_BASE_URL ?? 'https://receipt-assistant-production.up.railway.app';

// ─── Auth Middleware ───────────────────────────────────────────────────────────

function requireAdminKey(req: Request, res: Response, next: Function) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return next(); // No secret set → open (dev mode)

  const provided = req.headers['x-admin-key'] ?? req.query.key;
  if (provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── Registration Page ─────────────────────────────────────────────────────────

router.get('/register', (_req: Request, res: Response) => {
  res.send(REGISTER_HTML);
});

// ─── Create Tenant API ─────────────────────────────────────────────────────────

router.post('/tenants', requireAdminKey, async (req: Request, res: Response) => {
  const {
    name,
    line_channel_secret,
    line_channel_access_token,
    google_oauth_client_id,
    google_oauth_client_secret,
    google_oauth_refresh_token,
    spreadsheet_id,
    sheet_name,
    tour_groups,
    plan,
  } = req.body;

  const required = [
    'name', 'line_channel_secret', 'line_channel_access_token',
    'google_oauth_client_id', 'google_oauth_client_secret',
    'google_oauth_refresh_token', 'spreadsheet_id',
  ];

  const missing = required.filter((k) => !req.body[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  try {
    const tenant = await createTenant({
      name,
      line_channel_secret,
      line_channel_access_token,
      google_oauth_client_id,
      google_oauth_client_secret,
      google_oauth_refresh_token,
      spreadsheet_id,
      sheet_name: sheet_name || 'Expenses',
      tour_groups: tour_groups || [...DEFAULT_TOUR_GROUPS],
      plan: plan || 'free',
    });

    // Auto-create header row in their sheet
    try {
      await ensureHeaderRow(tenant);
    } catch (e) {
      logger.warn('Could not create header row', { tenantId: tenant.id, e });
    }

    const webhookUrl = `${WEBHOOK_BASE}/webhook/${tenant.id}`;

    return res.status(201).json({
      success: true,
      tenant_id: tenant.id,
      webhook_url: webhookUrl,
      message: `Set this URL in LINE Developers Console: ${webhookUrl}`,
    });
  } catch (err: any) {
    logger.error('createTenant failed', { err });
    return res.status(500).json({ error: err.message ?? 'Internal error' });
  }
});

// ─── List Tenants ──────────────────────────────────────────────────────────────

router.get('/tenants', requireAdminKey, async (_req: Request, res: Response) => {
  try {
    const tenants = await getAllActiveTenants();
    return res.json(
      tenants.map((t) => ({
        id: t.id,
        name: t.name,
        plan: t.plan,
        monthly_receipt_count: t.monthly_receipt_count,
        webhook_url: `${WEBHOOK_BASE}/webhook/${t.id}`,
        created_at: t.created_at,
      }))
    );
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Update Tenant ─────────────────────────────────────────────────────────────

router.patch('/tenants/:id', requireAdminKey, async (req: Request, res: Response) => {
  const { id } = req.params;
  const allowed = ['plan', 'is_active', 'sheet_name', 'tour_groups', 'spreadsheet_id'];
  const updates: any = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }

  try {
    await updateTenant(id, updates);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

// ─── Registration HTML ─────────────────────────────────────────────────────────

const REGISTER_HTML = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Receipt Bot — ลงทะเบียนองค์กร</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #f0f4f8; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: white; border-radius: 16px; padding: 40px; max-width: 560px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    h1 { font-size: 1.6rem; color: #1a1a2e; margin-bottom: 6px; }
    .subtitle { color: #666; margin-bottom: 28px; font-size: .95rem; }
    label { display: block; font-size: .85rem; font-weight: 600; color: #444; margin-bottom: 5px; margin-top: 18px; }
    input, select { width: 100%; padding: 10px 14px; border: 1.5px solid #dde; border-radius: 8px; font-size: .95rem; transition: border .2s; }
    input:focus, select:focus { outline: none; border-color: #06C755; }
    .hint { font-size: .78rem; color: #888; margin-top: 4px; }
    .section { background: #f8fafe; border-radius: 10px; padding: 16px 20px; margin-top: 20px; border: 1px solid #e8eef8; }
    .section h3 { font-size: .9rem; color: #3a3a6e; margin-bottom: 4px; }
    button { width: 100%; margin-top: 28px; padding: 14px; background: #06C755; color: white; border: none; border-radius: 10px; font-size: 1rem; font-weight: 700; cursor: pointer; transition: background .2s; }
    button:hover { background: #05a847; }
    button:disabled { background: #aaa; cursor: not-allowed; }
    .result { margin-top: 20px; padding: 16px; border-radius: 10px; display: none; }
    .result.success { background: #e8f8ee; border: 1px solid #06C755; }
    .result.error { background: #ffeef0; border: 1px solid #e74c3c; }
    .webhook-box { font-family: monospace; font-size: .82rem; background: #1a1a2e; color: #06C755; padding: 10px 14px; border-radius: 8px; margin-top: 10px; word-break: break-all; }
    .copy-btn { display: inline-block; margin-top: 8px; padding: 6px 12px; background: #06C755; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: .8rem; }
  </style>
</head>
<body>
<div class="card">
  <h1>🧾 Receipt Bot</h1>
  <p class="subtitle">ลงทะเบียนองค์กรใหม่ — กรอกข้อมูลด้านล่างเพื่อเชื่อมต่อ LINE OA และ Google Sheets</p>

  <form id="form">
    <div class="section">
      <h3>🏢 ข้อมูลองค์กร</h3>
      <label>ชื่อองค์กร / บริษัท *</label>
      <input name="name" placeholder="เช่น บริษัท ทัวร์ดี จำกัด" required>
      <label>แผน</label>
      <select name="plan">
        <option value="free">Free — 50 สลิป/เดือน</option>
        <option value="pro">Pro — 500 สลิป/เดือน (฿590)</option>
        <option value="business">Business — Unlimited (฿1,490)</option>
      </select>
    </div>

    <div class="section">
      <h3>💬 LINE OA Credentials</h3>
      <label>Channel Secret *</label>
      <input name="line_channel_secret" placeholder="abc123..." required>
      <p class="hint">LINE Developers Console → Basic Settings → Channel secret</p>
      <label>Channel Access Token *</label>
      <input name="line_channel_access_token" placeholder="eyJ0..." required>
      <p class="hint">LINE Developers Console → Messaging API → Channel access token</p>
    </div>

    <div class="section">
      <h3>📊 Google Sheets</h3>
      <label>Spreadsheet ID *</label>
      <input name="spreadsheet_id" placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms" required>
      <p class="hint">จาก URL: docs.google.com/spreadsheets/d/<strong>SPREADSHEET_ID</strong>/edit</p>
      <label>Sheet Name</label>
      <input name="sheet_name" placeholder="Expenses" value="Expenses">
    </div>

    <div class="section">
      <h3>🔑 Google OAuth2 Credentials</h3>
      <label>Client ID *</label>
      <input name="google_oauth_client_id" placeholder="352953758558-xxx.apps.googleusercontent.com" required>
      <label>Client Secret *</label>
      <input name="google_oauth_client_secret" placeholder="GOCSPX-xxx" required>
      <label>Refresh Token *</label>
      <input name="google_oauth_refresh_token" placeholder="1//0g..." required>
      <p class="hint">รันสคริปต์ <code>node scripts/google-auth.js</code> เพื่อรับ refresh token</p>
    </div>

    <button type="submit" id="btn">✅ ลงทะเบียนองค์กร</button>
  </form>

  <div class="result" id="result"></div>
</div>

<script>
document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn');
  btn.disabled = true; btn.textContent = 'กำลังสร้าง...';

  const data = Object.fromEntries(new FormData(e.target));
  const res = await fetch('/tenants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  const el = document.getElementById('result');
  el.style.display = 'block';

  if (res.ok) {
    el.className = 'result success';
    el.innerHTML = \`
      <strong>✅ ลงทะเบียนสำเร็จ!</strong><br><br>
      Tenant ID: <code>\${json.tenant_id}</code><br><br>
      <strong>ตั้ง Webhook URL นี้ใน LINE Developers Console:</strong>
      <div class="webhook-box" id="wh">\${json.webhook_url}</div>
      <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('wh').textContent)">📋 Copy</button>
    \`;
  } else {
    el.className = 'result error';
    el.innerHTML = \`<strong>❌ เกิดข้อผิดพลาด:</strong> \${json.error}\`;
  }
  btn.disabled = false; btn.textContent = '✅ ลงทะเบียนองค์กร';
});
</script>
</body>
</html>`;
