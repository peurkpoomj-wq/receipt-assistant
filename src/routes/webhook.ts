import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import type { WebhookRequestBody, WebhookEvent } from '@line/bot-sdk';
import type { PendingReceipt, SheetRow, Tenant } from '../types';
import {
  downloadLineImage,
  replyText,
  replyFlexTourGroupSelector,
  pushConfirmation,
} from '../services/line.service';
import { extractReceiptData } from '../services/vision.service';
import { appendReceiptRow, ensureHeaderRow } from '../services/sheets.service';
import { getTenantById, incrementReceiptCount } from '../db/tenants.repo';
import { buildLegacyTenant } from '../services/sheets.service';
import { logger } from '../utils/logger';

const router = Router();

// ─── In-memory pending store (tenantId:userId:messageId → receipt) ─────────────
const pendingReceipts = new Map<string, PendingReceipt>();

setInterval(() => {
  const ttl = 30 * 60 * 1000;
  const now = Date.now();
  for (const [key, val] of pendingReceipts) {
    if (now - val.createdAt > ttl) pendingReceipts.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Signature Verification ────────────────────────────────────────────────────

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ─── Resolve Tenant ────────────────────────────────────────────────────────────

async function resolveTenant(tenantId: string): Promise<Tenant | null> {
  // "legacy" = single-tenant mode via env vars (backward compat)
  if (tenantId === 'legacy') {
    return buildLegacyTenant();
  }

  try {
    // Check Supabase only if configured
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return await getTenantById(tenantId);
    }
  } catch (err) {
    logger.warn('Supabase lookup failed, falling back to legacy', { err });
  }

  return null;
}

// ─── Event Handlers ────────────────────────────────────────────────────────────

async function handleImageMessage(event: WebhookEvent, tenant: Tenant): Promise<void> {
  if (event.type !== 'message' || event.message.type !== 'image') return;

  const messageId = event.message.id;
  const userId = event.source.userId ?? 'unknown';
  const { replyToken } = event;

  logger.info('Image received', { tenantId: tenant.id, messageId, userId });

  // Download image
  let imageBuffer: Buffer;
  try {
    imageBuffer = await downloadLineImage(messageId, tenant);
    logger.info('Image downloaded', { messageId, sizeKB: Math.round(imageBuffer.length / 1024) });
  } catch (err) {
    logger.error('Image download failed', { messageId, err });
    await replyText(replyToken, 'ไม่สามารถดาวน์โหลดภาพได้ กรุณาลองใหม่อีกครั้ง', tenant).catch(() => {});
    return;
  }

  // Vision OCR
  let receipt;
  try {
    receipt = await extractReceiptData(imageBuffer);
  } catch (err) {
    logger.error('Vision API failed', { messageId, err });
    await replyText(replyToken, 'เกิดข้อผิดพลาดในการอ่านภาพ กรุณาลองใหม่อีกครั้ง', tenant).catch(() => {});
    return;
  }

  logger.info('Receipt extracted', { messageId, merchant: receipt.merchant_name, amount: receipt.total_amount, type: receipt.expense_type, error: receipt.error });

  if (receipt.error) {
    await replyText(
      replyToken,
      'ไม่สามารถอ่านเอกสารได้\nกรุณาส่งภาพใบเสร็จ, สลิปโอนเงิน หรือบิลค่าใช้จ่ายเท่านั้น',
      tenant
    ).catch(() => {});
    return;
  }

  // Group_Tour → ask user to pick tour group
  if (receipt.expense_type === 'Group_Tour') {
    const pendingKey = `${tenant.id}:${userId}:${messageId}`;
    pendingReceipts.set(pendingKey, {
      receipt,
      imageMessageId: messageId,
      createdAt: Date.now(),
    });
    logger.info('Pending Group_Tour', { pendingKey, merchant: receipt.merchant_name });

    await replyFlexTourGroupSelector(
      replyToken,
      { merchant: receipt.merchant_name, amount: receipt.total_amount, category: receipt.category, messageId },
      tenant
    ).catch((err) => logger.error('Flex send failed', { err }));
    return;
  }

  // Office → write to Sheets immediately
  const row: SheetRow = {
    date: receipt.date,
    merchant_name: receipt.merchant_name,
    total_amount: receipt.total_amount,
    category: receipt.category,
    expense_type: receipt.expense_type,
    tour_group: '',
    line_message_id: messageId,
    recorded_at: new Date().toISOString(),
  };

  try {
    await appendReceiptRow(row, tenant);
    await incrementReceiptCount(tenant.id).catch(() => {});
  } catch (err) {
    logger.error('Sheets write failed', { err, merchant: row.merchant_name });
    await replyText(replyToken, `อ่านสลิปได้แล้ว แต่บันทึก Sheet ไม่สำเร็จ\nร้าน: ${receipt.merchant_name} ฿${receipt.total_amount}`, tenant).catch(() => {});
    return;
  }

  await replyText(
    replyToken,
    [
      '✅ บันทึกรายจ่ายเรียบร้อยแล้ว!',
      '─────────────────────',
      `   ร้าน : ${receipt.merchant_name}`,
      `   ยอด  : ฿${receipt.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
      `   หมวด : ${receipt.category}`,
    ].join('\n'),
    tenant
  ).catch((err) => logger.warn('Reply token expired', { err }));
}

async function handlePostback(event: WebhookEvent, tenant: Tenant): Promise<void> {
  if (event.type !== 'postback') return;

  const userId = event.source.userId ?? 'unknown';
  const params = new URLSearchParams(event.postback.data);

  if (params.get('action') !== 'select_tour') return;

  const tourGroup = decodeURIComponent(params.get('group') ?? '');
  const messageId = params.get('msgId') ?? '';

  // Find pending receipt (specific key first, then any for this user)
  const specificKey = `${tenant.id}:${userId}:${messageId}`;
  let pendingKey = pendingReceipts.has(specificKey) ? specificKey : undefined;

  if (!pendingKey) {
    const prefix = `${tenant.id}:${userId}:`;
    for (const key of pendingReceipts.keys()) {
      if (key.startsWith(prefix)) { pendingKey = key; break; }
    }
  }

  const pending = pendingKey ? pendingReceipts.get(pendingKey) : undefined;

  if (!pending || !pendingKey) {
    await replyText(event.replyToken, 'ไม่พบข้อมูลใบเสร็จที่รอดำเนินการ\nกรุณาส่งภาพใบเสร็จอีกครั้ง', tenant);
    return;
  }

  pendingReceipts.delete(pendingKey);

  const { receipt, imageMessageId } = pending;
  const row: SheetRow = {
    date: receipt.date,
    merchant_name: receipt.merchant_name,
    total_amount: receipt.total_amount,
    category: receipt.category,
    expense_type: receipt.expense_type,
    tour_group: tourGroup,
    line_message_id: imageMessageId,
    recorded_at: new Date().toISOString(),
  };

  try {
    await appendReceiptRow(row, tenant);
    await incrementReceiptCount(tenant.id).catch(() => {});
  } catch (err) {
    logger.error('Sheets write failed (postback)', { err });
    await replyText(event.replyToken, 'บันทึก Sheet ไม่สำเร็จ กรุณาลองใหม่', tenant);
    return;
  }

  await pushConfirmation(userId, {
    merchant: receipt.merchant_name,
    amount: receipt.total_amount,
    category: receipt.category,
    expenseType: receipt.expense_type,
    tourGroup,
  }, tenant);
}

// ─── Webhook Route — supports /webhook/:tenantId ───────────────────────────────

router.post('/:tenantId?', async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId ?? 'legacy';
  const signature = req.headers['x-line-signature'] as string | undefined;

  if (!signature) {
    return res.status(400).json({ error: 'Missing X-Line-Signature' });
  }

  // Resolve tenant
  const tenant = await resolveTenant(tenantId);
  if (!tenant) {
    logger.warn('Unknown tenant', { tenantId });
    return res.status(404).json({ error: 'Tenant not found' });
  }

  const rawBody: string = (req as any).rawBody ?? JSON.stringify(req.body);

  if (!verifySignature(rawBody, signature, tenant.line_channel_secret)) {
    logger.warn('Signature verification failed', { tenantId });
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // Respond 200 immediately (LINE requires < 30s)
  res.status(200).json({ status: 'ok' });

  const { events = [] } = req.body as WebhookRequestBody;

  for (const event of events) {
    try {
      if (event.type === 'message' && event.message.type === 'image') {
        await handleImageMessage(event, tenant);
      } else if (event.type === 'postback') {
        await handlePostback(event, tenant);
      }
    } catch (err) {
      logger.error(`Unhandled error in ${event.type} event`, { tenantId, err });
    }
  }
});

export default router;
