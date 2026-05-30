import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import type { WebhookRequestBody, WebhookEvent } from '@line/bot-sdk';
import type { PendingReceipt, SheetRow } from '../types';
import {
  downloadLineImage,
  replyText,
  replyFlexCostCenterSelector,
  pushConfirmation,
  getCostCenters,
} from '../services/line.service';
import { extractReceiptData } from '../services/vision.service';
import { appendReceiptRow } from '../services/sheets.service';
import { logger } from '../utils/logger';

const router = Router();

// ─── In-memory pending store ───────────────────────────────────────────────────
const pendingReceipts = new Map<string, PendingReceipt>();

setInterval(() => {
  const ttl = 30 * 60 * 1000; // 30 minutes
  const now = Date.now();
  for (const [key, val] of pendingReceipts) {
    if (now - val.createdAt > ttl) pendingReceipts.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Signature Verification ────────────────────────────────────────────────────

function verifySignature(rawBody: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) throw new Error('LINE_CHANNEL_SECRET is not set');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ─── Validation helpers ────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeDate(raw: string): string {
  if (DATE_RE.test(raw)) return raw;
  // Try to parse partial dates like "22/05/2025" → "2025-05-22"
  const parts = raw.split(/[\/\-\.]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (c && c.length === 4) return `${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
    if (a && a.length === 4) return `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`;
  }
  return raw; // pass through, let Sheets handle it
}

// ─── Event Handlers ────────────────────────────────────────────────────────────

async function handleImageMessage(event: WebhookEvent): Promise<void> {
  if (event.type !== 'message' || event.message.type !== 'image') return;

  const messageId = event.message.id;
  const userId = event.source.userId;
  const { replyToken } = event;

  // FIX: reject anonymous messages (no userId)
  if (!userId) {
    logger.warn('Image message with no userId — ignoring', { messageId });
    return;
  }

  logger.info('Image message received', { messageId, userId });

  let imageBuffer: Buffer;
  try {
    imageBuffer = await downloadLineImage(messageId);
    logger.info('Image downloaded', { messageId, sizeKB: Math.round(imageBuffer.length / 1024) });
  } catch (err) {
    logger.error('Failed to download image from LINE', { messageId, err });
    await replyText(replyToken, 'ไม่สามารถดาวน์โหลดภาพได้ กรุณาลองใหม่อีกครั้ง').catch(() => {});
    return;
  }

  let receipt;
  try {
    receipt = await extractReceiptData(imageBuffer);
  } catch (err) {
    logger.error('Vision API error', { messageId, err });
    await replyText(replyToken, 'เกิดข้อผิดพลาดในการอ่านภาพ กรุณาลองใหม่อีกครั้ง').catch(() => {});
    return;
  }

  logger.info('Receipt extracted', { messageId, receipt });

  if (receipt.error) {
    logger.warn('Not a financial document', { messageId, error: receipt.error });
    await replyText(
      replyToken,
      `ไม่สามารถอ่านเอกสารได้\n\nกรุณาส่งภาพใบเสร็จ, สลิปโอนเงิน หรือบิลค่าใช้จ่ายเท่านั้น`
    ).catch(() => {});
    return;
  }

  // FIX: validate amount > 0
  if (!receipt.total_amount || receipt.total_amount <= 0) {
    logger.warn('Invalid amount from Vision API', { amount: receipt.total_amount });
    await replyText(replyToken, 'ไม่สามารถอ่านยอดเงินได้ กรุณาลองใหม่').catch(() => {});
    return;
  }

  // FIX: sanitize date format
  const sanitizedDate = sanitizeDate(receipt.date || '');

  const costCenters = getCostCenters();

  // FIX: auto-save only when exactly 1 cost center (configured via COST_CENTERS env var)
  // Default has 6 options so will always show picker — this is the intended behavior
  if (costCenters.length === 1) {
    const row: SheetRow = {
      date: sanitizedDate,
      merchant_name: receipt.merchant_name,
      total_amount: receipt.total_amount,
      category: receipt.category,
      cost_center: costCenters[0],
      line_message_id: messageId,
      recorded_at: new Date().toISOString(),
    };
    try {
      await appendReceiptRow(row);
    } catch (err) {
      logger.error('Failed to write to Google Sheets', { err });
      await replyText(replyToken, `อ่านสลิปได้แล้ว แต่บันทึก Sheet ไม่สำเร็จ\nร้าน: ${receipt.merchant_name} ฿${receipt.total_amount}`).catch(() => {});
      return;
    }
    await replyText(
      replyToken,
      [
        '✅ บันทึกรายจ่ายเรียบร้อยแล้ว!',
        '─────────────────────',
        `   ร้าน       : ${receipt.merchant_name}`,
        `   ยอด        : ฿${receipt.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
        `   หมวด       : ${receipt.category}`,
        `   Cost Center: ${costCenters[0]}`,
      ].join('\n')
    ).catch((err) => logger.warn('Reply failed (token may have expired)', { err }));
    return;
  }

  // Multiple cost centers → ask user to pick
  const pendingKey = `${userId}:${messageId}`;
  pendingReceipts.set(pendingKey, {
    receipt: { ...receipt, date: sanitizedDate },
    imageMessageId: messageId,
    createdAt: Date.now(),
  });
  logger.info('Stored pending receipt, awaiting cost center', { pendingKey, merchant: receipt.merchant_name });

  await replyFlexCostCenterSelector(replyToken, {
    merchant: receipt.merchant_name,
    amount: receipt.total_amount,
    category: receipt.category,
    messageId,
    costCenters,
  }).catch((err) => logger.error('Failed to send Flex Message', { err }));
}

async function handlePostback(event: WebhookEvent): Promise<void> {
  if (event.type !== 'postback') return;

  const userId = event.source.userId;
  if (!userId) return; // FIX: reject anonymous postbacks

  const params = new URLSearchParams(event.postback.data);
  if (params.get('action') !== 'select_cost_center') return;

  const costCenter = decodeURIComponent(params.get('center') ?? '');
  const messageId = params.get('msgId') ?? '';

  // FIX: validate costCenter against allowed list to prevent injection
  const allowedCenters = getCostCenters();
  if (!allowedCenters.includes(costCenter)) {
    logger.warn('Invalid cost center in postback', { costCenter, userId });
    await replyText(event.replyToken, 'ข้อมูลไม่ถูกต้อง กรุณาลองใหม่');
    return;
  }

  const specificKey = `${userId}:${messageId}`;
  let pendingKey = pendingReceipts.has(specificKey) ? specificKey : undefined;

  if (!pendingKey) {
    for (const key of pendingReceipts.keys()) {
      if (key.startsWith(`${userId}:`)) { pendingKey = key; break; }
    }
  }

  const pending = pendingKey ? pendingReceipts.get(pendingKey) : undefined;

  if (!pending || !pendingKey) {
    await replyText(
      event.replyToken,
      'ไม่พบข้อมูลใบเสร็จที่รอดำเนินการ\nกรุณาส่งภาพใบเสร็จอีกครั้ง'
    ).catch(() => {});
    return;
  }

  pendingReceipts.delete(pendingKey);

  const { receipt, imageMessageId } = pending;
  const row: SheetRow = {
    date: receipt.date,
    merchant_name: receipt.merchant_name,
    total_amount: receipt.total_amount,
    category: receipt.category,
    cost_center: costCenter,
    line_message_id: imageMessageId,
    recorded_at: new Date().toISOString(),
  };

  try {
    await appendReceiptRow(row);
  } catch (err) {
    logger.error('Failed to write to Sheets (postback)', { err });
    await replyText(event.replyToken, 'บันทึก Sheet ไม่สำเร็จ กรุณาลองใหม่').catch(() => {});
    return;
  }

  await pushConfirmation(userId, {
    merchant: receipt.merchant_name,
    amount: receipt.total_amount,
    category: receipt.category,
    costCenter,
  }).catch((err) => logger.warn('Push confirmation failed', { err }));
}

// ─── Webhook Route ─────────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const signature = req.headers['x-line-signature'] as string | undefined;

  if (!signature) {
    return res.status(400).json({ error: 'Missing X-Line-Signature header' });
  }

  // FIX: require rawBody — if missing, fail immediately rather than signing wrong content
  const rawBody = (req as Request & { rawBody?: string }).rawBody;
  if (!rawBody) {
    logger.error('rawBody missing — request body middleware may be misconfigured');
    return res.status(400).json({ error: 'Cannot verify signature' });
  }

  try {
    if (!verifySignature(rawBody, signature)) {
      logger.warn('LINE signature verification failed');
      return res.status(403).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    logger.error('Signature check threw', { err });
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // Respond 200 immediately — LINE requires response within 30s
  res.status(200).json({ status: 'ok' });

  const { events = [] } = req.body as WebhookRequestBody;

  for (const event of events) {
    try {
      if (event.type === 'message' && event.message.type === 'image') {
        await handleImageMessage(event);
      } else if (event.type === 'postback') {
        await handlePostback(event);
      }
    } catch (err) {
      logger.error(`Unhandled error in ${event.type} handler`, err);
    }
  }
});

export default router;
