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
  // Option 1: JSON string in env — supports both service_account and authorized_user
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const json = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) as Record<string, string>;
    // authorized_user type (from scripts/google-auth.js)
    if (json.type === 'authorized_user') {
      const client = new UserRefreshClient({
        clientId:     json.client_id,
        clientSecret: json.client_secret,
        refreshToken: json.refresh_token,
      });
      return client;
    }
    // service_account type
    return new GoogleAuth({ credentials: json, scopes: SCOPES });
  }

  // Option 2: Key file path (service account OR authorized_user)
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (keyFile) {
    try {
      fs.accessSync(path.resolve(keyFile));
      return new GoogleAuth({ keyFile: path.resolve(keyFile), scopes: SCOPES });
    } catch { /* fall through */ }
  }

  // Option 3: GOOGLE_APPLICATION_CREDENTIALS (local dev with google-oauth2.json)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    return new GoogleAuth({ keyFile: credPath, scopes: SCOPES });
  }

  throw new Error('Google credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON in env.');
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
  return google.sheets({ version: 'v4', auth: authClient as Parameters<typeof google.sheets>[0]['auth'] });
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
