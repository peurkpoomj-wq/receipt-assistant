import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
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

function getAuth(): GoogleAuth {
  // Option 1: Service account JSON string (cloud deployments)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) as object;
    return new GoogleAuth({ credentials, scopes: SCOPES });
  }

  // Option 2: Explicit key file path (service account OR authorized_user JSON)
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (keyFile) {
    try {
      fs.accessSync(path.resolve(keyFile));
      return new GoogleAuth({ keyFile: path.resolve(keyFile), scopes: SCOPES });
    } catch {
      // File doesn't exist — fall through
    }
  }

  // Option 3: GOOGLE_APPLICATION_CREDENTIALS env var (authorized_user / ADC)
  // GoogleAuth auto-reads this env var — works with google-oauth2.json from scripts/google-auth.js
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    return new GoogleAuth({ keyFile: credPath, scopes: SCOPES });
  }

  throw new Error(
    'Google credentials not configured. Set GOOGLE_APPLICATION_CREDENTIALS=./credentials/google-oauth2.json'
  );
}

function getConfig(): { spreadsheetId: string; sheetName: string } {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SPREADSHEET_ID is not set.');
  return { spreadsheetId, sheetName: process.env.GOOGLE_SHEET_NAME ?? 'Expenses' };
}

async function getSheetsClient() {
  const auth = getAuth();
  const authClient = await auth.getClient();
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
