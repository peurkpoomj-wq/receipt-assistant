import { google } from 'googleapis';
import { GoogleAuth, UserRefreshClient } from 'google-auth-library';
import path from 'path';
import fs from 'fs';
import { SheetRow, MonthSummary, DaySummary } from '../types';
import { logger } from '../utils/logger';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const HEADERS = [
  'Date',
  'Merchant',
  'Amount (THB)',
  'Category',
  'Expense Type',
  'Tour Group',
  'Submitted By',
  'Department',
  'LINE Message ID',
  'Recorded At',
];

function getAuth(): GoogleAuth | UserRefreshClient {
  if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    return new UserRefreshClient({
      clientId:     process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
    });
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const json = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) as Record<string, string>;
      if (json.type === 'authorized_user') {
        return new UserRefreshClient({
          clientId:     json.client_id,
          clientSecret: json.client_secret,
          refreshToken: json.refresh_token,
        });
      }
      return new GoogleAuth({ credentials: json, scopes: SCOPES });
    } catch (e) {
      logger.warn('GOOGLE_SERVICE_ACCOUNT_JSON parse failed', e);
    }
  }

  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
    || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyFile) {
    try {
      fs.accessSync(path.resolve(keyFile));
      return new GoogleAuth({ keyFile: path.resolve(keyFile), scopes: SCOPES });
    } catch { /* fall through */ }
  }

  throw new Error('Google credentials not configured. Set GOOGLE_OAUTH_REFRESH_TOKEN in env.');
}

function getConfig(): { spreadsheetId: string; sheetName: string } {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SPREADSHEET_ID is not set.');
  return { spreadsheetId, sheetName: process.env.GOOGLE_SHEET_NAME ?? 'Expenses' };
}

async function getSheetsClient() {
  const auth = getAuth();
  const authClient = auth instanceof UserRefreshClient
    ? auth
    : await (auth as GoogleAuth).getClient();
  return google.sheets({ version: 'v4', auth: authClient as Parameters<typeof google.sheets>[0]['auth'] });
}

// ─── Write ─────────────────────────────────────────────────────────────────────

export async function appendReceiptRow(row: SheetRow): Promise<void> {
  const sheets = await getSheetsClient();
  const { spreadsheetId, sheetName } = getConfig();

  const values = [[
    row.date,
    row.merchant_name,
    row.total_amount,
    row.category,
    row.expense_type,
    row.tour_group,
    row.submitted_by,
    row.department,
    row.line_message_id,
    row.recorded_at,
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:J`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });

  logger.info('Appended row to Sheets', {
    merchant: row.merchant_name,
    amount: row.total_amount,
    submitted_by: row.submitted_by || '—',
  });
}

export async function ensureHeaderRow(): Promise<void> {
  const sheets = await getSheetsClient();
  const { spreadsheetId, sheetName } = getConfig();

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:J1`,
  });

  const existingHeaders = (existing.data.values?.[0] ?? []) as string[];

  if (existingHeaders.length === 0) {
    // Fresh sheet — write full headers
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:J1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
    logger.info('Created header row in Google Sheets');
    return;
  }

  // Migrate old 8-column sheet: add Submitted By and Department at I1:J1
  if (existingHeaders.length === 8 && !existingHeaders.includes('Submitted By')) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!I1:J1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Submitted By', 'Department']] },
    });
    logger.info('Migrated Google Sheets header: added Submitted By + Department columns');
  }
}

// ─── Read ──────────────────────────────────────────────────────────────────────

function parseRow(row: string[]): SheetRow {
  return {
    date:           row[0]  ?? '',
    merchant_name:  row[1]  ?? '',
    total_amount:   parseFloat(row[2] ?? '0') || 0,
    category:       row[3]  ?? '',
    expense_type:   row[4]  ?? '',
    tour_group:     row[5]  ?? '',
    submitted_by:   row[6]  ?? '',
    department:     row[7]  ?? '',
    line_message_id: row[8] ?? '',
    recorded_at:    row[9]  ?? '',
  };
}

export async function readAllExpenses(): Promise<SheetRow[]> {
  const sheets = await getSheetsClient();
  const { spreadsheetId, sheetName } = getConfig();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:J`,
  });

  return (res.data.values ?? []).map(row => parseRow(row as string[]));
}

export async function getMonthSummary(year?: number, month?: number): Promise<MonthSummary> {
  const now = new Date();
  const y = year ?? now.getFullYear();
  const m = month ?? now.getMonth() + 1; // 1-based

  const all = await readAllExpenses();

  const monthRows = all.filter(row => {
    const d = new Date(row.date);
    return d.getFullYear() === y && d.getMonth() + 1 === m;
  });

  const byCategory: Record<string, number> = {};
  let totalAmount = 0;

  for (const row of monthRows) {
    totalAmount += row.total_amount;
    byCategory[row.category] = (byCategory[row.category] ?? 0) + row.total_amount;
  }

  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('th-TH', {
    month: 'long',
    year: 'numeric',
  });

  return {
    month: monthLabel,
    totalAmount,
    transactionCount: monthRows.length,
    byCategory,
  };
}

export async function getTodaySummary(): Promise<DaySummary> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const all = await readAllExpenses();

  const todayRows = all.filter(row => row.date.startsWith(today) || row.recorded_at.startsWith(today));
  const total = todayRows.reduce((sum, r) => sum + r.total_amount, 0);

  return { count: todayRows.length, total };
}

export async function getUserRecentExpenses(displayName: string, limit = 10): Promise<SheetRow[]> {
  const all = await readAllExpenses();
  return all
    .filter(row => row.submitted_by === displayName)
    .slice(-limit)
    .reverse();
}
