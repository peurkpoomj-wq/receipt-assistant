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

function validate(raw: unknown): ExtractedReceipt {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Vision API returned non-object: ${typeof raw}`);
  }

  const obj = raw as Record<string, unknown>;

  // Error response from AI (unreadable image)
  if (typeof obj.error === 'string') {
    return { error: obj.error } as ExtractedReceipt;
  }

  if (typeof obj.date !== 'string') throw new Error('Missing or invalid "date"');
  if (typeof obj.merchant_name !== 'string') throw new Error('Missing or invalid "merchant_name"');
  if (typeof obj.total_amount !== 'number') throw new Error('"total_amount" must be a number');
  if (!VALID_CATEGORIES.includes(obj.category as ExtractedReceipt['category'])) {
    throw new Error(`Invalid category: "${obj.category}"`);
  }

  return {
    date: obj.date,
    merchant_name: obj.merchant_name,
    total_amount: obj.total_amount,
    category: obj.category as ExtractedReceipt['category'],
  };
}

export async function extractReceiptData(imageBuffer: Buffer): Promise<ExtractedReceipt> {
  const base64 = imageBuffer.toString('base64');
  const modelName = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

  logger.info('Calling Gemini Vision API', { model: modelName, imageSizeKB: Math.round(imageBuffer.length / 1024) });

  const geminiModel = getGenAI().getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  });

  const result = await geminiModel.generateContent([
    { inlineData: { data: base64, mimeType: 'image/jpeg' } },
    RECEIPT_SYSTEM_PROMPT + '\n\nกรุณาดึงข้อมูลจากเอกสารนี้',
  ]);

  const rawContent = result.response.text();
  if (!rawContent) throw new Error('Empty response from Gemini API');

  logger.debug('Gemini raw output', { content: rawContent });

  // Strip markdown fences in case Gemini wraps output in ```json ... ```
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
