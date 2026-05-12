import OpenAI from 'openai';
import { ExtractedReceipt } from '../types';
import { RECEIPT_SYSTEM_PROMPT } from '../prompts/receipt.prompt';
import { logger } from '../utils/logger';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const VALID_CATEGORIES: ExtractedReceipt['category'][] = [
  'อาหารและเครื่องดื่ม',
  'อุปกรณ์สำนักงาน',
  'เดินทางและที่พัก',
  'จิปาถะ',
];
const VALID_EXPENSE_TYPES: ExtractedReceipt['expense_type'][] = ['Office', 'Group_Tour'];

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
  if (!VALID_EXPENSE_TYPES.includes(obj.expense_type as ExtractedReceipt['expense_type'])) {
    throw new Error(`Invalid expense_type: "${obj.expense_type}"`);
  }

  return {
    date: obj.date,
    merchant_name: obj.merchant_name,
    total_amount: obj.total_amount,
    category: obj.category as ExtractedReceipt['category'],
    expense_type: obj.expense_type as ExtractedReceipt['expense_type'],
  };
}

export async function extractReceiptData(imageBuffer: Buffer): Promise<ExtractedReceipt> {
  const base64 = imageBuffer.toString('base64');
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o';

  logger.info('Calling Vision API', { model, imageSizeKB: Math.round(imageBuffer.length / 1024) });

  const response = await getOpenAI().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: RECEIPT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'high' },
          },
          { type: 'text', text: 'กรุณาดึงข้อมูลจากเอกสารนี้' },
        ],
      },
    ],
    max_tokens: 500,
    temperature: 0,
    response_format: { type: 'json_object' }, // guarantees valid JSON output
  });

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent) throw new Error('Empty response from Vision API');

  logger.debug('Vision API raw output', { content: rawContent });

  const parsed: unknown = JSON.parse(rawContent);
  const result = validate(parsed);

  logger.info('Extracted receipt data', {
    merchant: result.merchant_name,
    amount: result.total_amount,
    expense_type: result.expense_type,
    error: result.error,
  });

  return result;
}
