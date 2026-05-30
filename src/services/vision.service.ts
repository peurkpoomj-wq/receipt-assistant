import { GoogleGenerativeAI } from '@google/generative-ai';
import { ExtractedReceipt } from '../types';
import { RECEIPT_SYSTEM_PROMPT } from '../prompts/receipt.prompt';
import { logger } from '../utils/logger';

let _genAI: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  return _genAI;
}

const VALID_CATEGORIES: ExtractedReceipt['category'][] = [
  'อาหารและเครื่องดื่ม',
  'อุปกรณ์สำนักงาน',
  'เดินทางและที่พัก',
  'จิปาถะ',
];
const VALID_TYPES: ExtractedReceipt['transaction_type'][] = ['รายรับ', 'รายจ่าย'];

function validate(raw: unknown): ExtractedReceipt {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Vision API returned non-object: ${typeof raw}`);
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.error === 'string') {
    return { error: obj.error } as ExtractedReceipt;
  }

  if (typeof obj.date !== 'string') throw new Error('Missing or invalid "date"');
  if (typeof obj.merchant_name !== 'string') throw new Error('Missing or invalid "merchant_name"');
  if (typeof obj.total_amount !== 'number') throw new Error('"total_amount" must be a number');
  if (!VALID_CATEGORIES.includes(obj.category as ExtractedReceipt['category'])) {
    throw new Error(`Invalid category: "${obj.category}"`);
  }

  // transaction_type — default to รายจ่าย if missing/invalid (backwards compat)
  const txType = VALID_TYPES.includes(obj.transaction_type as ExtractedReceipt['transaction_type'])
    ? (obj.transaction_type as ExtractedReceipt['transaction_type'])
    : 'รายจ่าย';

  return {
    date: obj.date,
    merchant_name: obj.merchant_name,
    total_amount: obj.total_amount,
    category: obj.category as ExtractedReceipt['category'],
    transaction_type: txType,
  };
}

// Retry with exponential backoff for rate limit errors (429)
async function callGeminiWithRetry(
  geminiModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']>,
  base64: string,
  prompt: string,
  maxRetries = 3
): Promise<string> {
  const delays = [10_000, 30_000, 60_000]; // 10s, 30s, 60s

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await geminiModel.generateContent([
        { inlineData: { data: base64, mimeType: 'image/jpeg' } },
        prompt,
      ]);
      return result.response.text();
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      const isRateLimit = status === 429;

      if (isRateLimit && attempt < maxRetries) {
        const delay = delays[attempt] ?? 60_000;
        logger.warn(`Gemini rate limit (429) — retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Gemini: max retries exceeded');
}

export async function extractReceiptData(imageBuffer: Buffer): Promise<ExtractedReceipt> {
  const base64 = imageBuffer.toString('base64');
  const modelName = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  logger.info('Calling Gemini Vision API', { model: modelName, imageSizeKB: Math.round(imageBuffer.length / 1024) });

  const geminiModel = getGenAI().getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  });

  // Inject company account names so the model can detect รายรับ vs รายจ่าย
  // by checking whether OUR company is the RECIPIENT (income) or SENDER (expense)
  const companyNames = (process.env.COMPANY_ACCOUNT_NAMES ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);

  let companyContext = '';
  if (companyNames.length) {
    companyContext = `\n\n========== ข้อมูลบริษัทของเรา (สำคัญมากต่อ transaction_type) ==========
ชื่อบัญชี/บริษัทของเรา: ${companyNames.join(', ')}
กฎการแยก transaction_type:
- ถ้า "ผู้รับเงิน/ปลายทาง/ไปยัง/บัญชีปลายทาง" ตรงหรือใกล้เคียงกับชื่อบริษัทเรา → "รายรับ" (ลูกค้าโอนค่าทัวร์เข้าบริษัท)
- ถ้า "ผู้โอน/ต้นทาง/จาก" ตรงกับชื่อบริษัทเรา → "รายจ่าย" (บริษัทจ่ายเงินออก)
- ใบเสร็จ/ใบกำกับภาษีที่บริษัทเราเป็นผู้ซื้อ → "รายจ่าย"
====================================================================`;
  }

  const fullPrompt = RECEIPT_SYSTEM_PROMPT + companyContext + '\n\nกรุณาดึงข้อมูลจากเอกสารนี้';
  const rawContent = await callGeminiWithRetry(geminiModel, base64, fullPrompt);
  if (!rawContent) throw new Error('Empty response from Gemini API');

  logger.debug('Gemini raw output', { content: rawContent });

  const cleaned = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parsed: unknown = JSON.parse(cleaned);
  const receipt = validate(parsed);

  logger.info('Extracted receipt data', {
    merchant: receipt.merchant_name,
    amount: receipt.total_amount,
    error: receipt.error,
  });

  return receipt;
}
