import { google } from 'googleapis';
import { UserRefreshClient } from 'google-auth-library';
import { SheetRow, Tenant } from '../types';
import { logger } from '../utils/logger';

const HEADERS = [
  'Date',
  'Merchant',
  'Amount (THB)',
  'Category',
  'Expense Type',
  'Tour Group',
  'LINE Message ID',
  'Recorded At',
];

// ─── Per-Tenant Auth ───────────────────────────────────────────────────────────

function getTenantSheetsClient(tenant: Tenant) {
  const auth = new UserRefreshClient({
    clientId: tenant.google_oauth_client_id,
    clientSecret: tenant.google_oauth_client_secret,
    refreshToken: tenant.google_oauth_refresh_token,
  });
  return google.sheets({ version: 'v4', auth: auth as any });
}

// ─── Public API (tenant-aware) ────────────────────────────────────────────────

export async function appendReceiptRow(row: SheetRow, tenant: Tenant): Promise<void> {
  const sheets = getTenantSheetsClient(tenant);

  const values = [[
    row.date,
    row.merchant_name,
    row.total_amount,
    row.category,
    row.expense_type,
    row.tour_group,
    row.line_message_id,
    row.recorded_at,
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: tenant.spreadsheet_id,
    range: `${tenant.sheet_name}!A:H`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });

  logger.info('Appended row to Sheets', {
    tenantId: tenant.id,
    merchant: row.merchant_name,
    amount: row.total_amount,
  });
}

export async function ensureHeaderRow(tenant: Tenant): Promise<void> {
  const sheets = getTenantSheetsClient(tenant);

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: tenant.spreadsheet_id,
    range: `${tenant.sheet_name}!A1:H1`,
  });

  if (!existing.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: tenant.spreadsheet_id,
      range: `${tenant.sheet_name}!A1:H1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
    logger.info('Created header row', { tenantId: tenant.id });
  }
}

// ─── Legacy single-tenant (backward compat — reads from env vars) ─────────────

export function buildLegacyTenant(): Tenant | null {
  const refresh = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const spreadsheet = process.env.GOOGLE_SPREADSHEET_ID;
  if (!refresh || !spreadsheet) return null;

  return {
    id: 'legacy',
    name: 'Default Tenant',
    line_channel_secret: process.env.LINE_CHANNEL_SECRET ?? '',
    line_channel_access_token: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '',
    google_oauth_client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    google_oauth_client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    google_oauth_refresh_token: refresh,
    spreadsheet_id: spreadsheet,
    sheet_name: process.env.GOOGLE_SHEET_NAME ?? 'Expenses',
    tour_groups: ['กรุ๊ปญี่ปุ่น', 'กรุ๊ปเกาหลี', 'กรุ๊ปยุโรป', 'กรุ๊ปจีน', 'กรุ๊ปออสเตรเลีย'],
    plan: 'business',
    monthly_receipt_count: 0,
    monthly_reset_at: new Date().toISOString(),
    is_active: true,
    created_at: new Date().toISOString(),
  };
}
