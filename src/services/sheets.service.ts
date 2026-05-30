import { google } from 'googleapis';
import { GoogleAuth, UserRefreshClient } from 'google-auth-library';
import path from 'path';
import fs from 'fs';
import { SheetRow, MonthlyReport, GroupSummary, TransactionType } from '../types';
import { logger } from '../utils/logger';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const HEADERS = [
  'Date',
  'Merchant',
  'Amount (THB)',
  'Category',
  'Type',         // รายรับ / รายจ่าย
  'Cost Center',
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

// Cache sheets client — avoids refreshing token on every request
let _sheetsClient: ReturnType<typeof google.sheets> | null = null;

async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;
  const auth = getAuth();
  const authClient = auth instanceof UserRefreshClient
    ? auth
    : await (auth as GoogleAuth).getClient();
  _sheetsClient = google.sheets({ version: 'v4', auth: authClient as unknown as Parameters<typeof google.sheets>[0]['auth'] });
  return _sheetsClient;
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function appendReceiptRow(row: SheetRow): Promise<void> {
  const sheets = await getSheetsClient();
  const { spreadsheetId, sheetName } = getConfig();

  const values = [[
    row.date,
    row.merchant_name,
    row.total_amount,
    row.category,
    row.transaction_type,
    row.cost_center,
    row.line_message_id,
    row.recorded_at,
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:H`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });

  logger.info('Appended row to Sheets', {
    merchant: row.merchant_name,
    amount: row.total_amount,
    type: row.transaction_type,
    cost_center: row.cost_center || '—',
  });
}

export async function ensureHeaderRow(): Promise<void> {
  const sheets = await getSheetsClient();
  const { spreadsheetId, sheetName } = getConfig();

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:H1`,
  });

  if (!existing.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:H1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
    logger.info('Created header row in Google Sheets');
  }
}

// ─── Monthly Report ────────────────────────────────────────────────────────────

export async function getMonthlyReport(yearMonth?: string): Promise<MonthlyReport> {
  const sheets = await getSheetsClient();
  const { spreadsheetId, sheetName } = getConfig();

  // Default to current month in Buddhist calendar display, CE for filtering
  const now = new Date();
  const targetMonth = yearMonth ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:H`,
  });

  const rows = res.data.values ?? [];
  // Skip header row (index 0)
  const dataRows = rows.slice(1);

  // Filter rows matching the target month
  // Columns: [date, merchant, amount, category, type, cost_center, line_msg_id, recorded_at]
  const filtered = dataRows.filter(row => {
    const date = String(row[0] ?? '');
    return date.startsWith(targetMonth);
  });

  // Aggregate
  const groupMap = new Map<string, GroupSummary>();

  for (const row of filtered) {
    const amount  = parseFloat(String(row[2] ?? '0').replace(/,/g, '')) || 0;
    const type    = String(row[4] ?? '') as TransactionType;
    const center  = String(row[5] ?? 'ไม่ระบุ');

    if (!groupMap.has(center)) {
      groupMap.set(center, { name: center, income: 0, expense: 0, net: 0, count: 0 });
    }
    const g = groupMap.get(center)!;
    g.count++;
    if (type === 'รายรับ') {
      g.income += amount;
    } else {
      g.expense += amount;
    }
    g.net = g.income - g.expense;
  }

  const groups = Array.from(groupMap.values())
    .sort((a, b) => b.income - a.income);

  const totalIncome  = groups.reduce((s, g) => s + g.income, 0);
  const totalExpense = groups.reduce((s, g) => s + g.expense, 0);

  // Convert to Thai month display (CE → BE)
  const [year, mon] = targetMonth.split('-');
  const thaiMonths = ['', 'ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                          'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const monthLabel = `${thaiMonths[parseInt(mon)]} ${parseInt(year) + 543}`;

  return {
    month: monthLabel,
    totalIncome,
    totalExpense,
    net: totalIncome - totalExpense,
    groups,
  };
}
