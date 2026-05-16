import { google } from 'googleapis';
import { GoogleAuth, UserRefreshClient } from 'google-auth-library';
import path from 'path';
import fs from 'fs';
import { SheetRow } from '../types';
import { logger } from '../utils/logger';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

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

function getAuth(): GoogleAuth | UserRefreshClient {
  // Option 1: Individual OAuth2 env vars (cloud-safe, no JSON escaping issues)
  if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    return new UserRefreshClient({
      clientId:     process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
    });
  }

  // Option 2: JSON string (service_account or authorized_user)
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

  // Option 3: Key file path
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
  // UserRefreshClient ใช้โดยตรงได้เลย, GoogleAuth ต้อง getClient() ก่อน
  const authClient = auth instanceof UserRefreshClient
    ? auth
    : await (auth as GoogleAuth).getClient();
  return google.sheets({ version: 'v4', auth: authClient as unknown as Parameters<typeof google.sheets>[0]['auth'] });
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
    row.expense_type,
    row.tour_group,
    row.line_message_id,
    row.recorded_at,
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:H`,
    valueInputOption: 'USER_ENTERED', // lets Sheets parse dates and numbers
    requestBody: { values },
  });

  logger.info('Appended row to Sheets', {
    merchant: row.merchant_name,
    amount: row.total_amount,
    tour_group: row.tour_group || '—',
  });
}

// Creates the header row on first run if the sheet is empty
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
