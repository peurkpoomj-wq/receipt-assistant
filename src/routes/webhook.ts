import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import type { WebhookRequestBody, WebhookEvent } from '@line/bot-sdk';
import type { PendingReceipt, SheetRow } from '../types';
import { DEPARTMENTS } from '../types';
import {
  downloadLineImage,
  replyText,
  replyFlexTourGroupSelector,
  pushConfirmation,
  replyAskName,
  replyAskDepartment,
  replyRegistrationComplete,
  replyFlex,
} from '../services/line.service';
import { extractReceiptData } from '../services/vision.service';
import {
  appendReceiptRow,
  getMonthSummary,
  getUserRecentExpenses,
} from '../services/sheets.service';
import {
  isRegistered,
  getUser,
  getUserDisplayName,
  getUserDepartment,
  registerUser,
  startRegistration,
  getPendingRegistration,
  advanceRegistration,
} from '../services/user.service';
import {
  buildMonthlySummaryFlex,
  buildMyExpensesFlex,
  buildHelpText,
} from '../services/report.service';
import { logger } from '../utils/logger';

const router = Router();

// ─── In-memory pending store (userId → receipt awaiting tour group) ────────────
const pendingReceipts = new Map<string, PendingReceipt>();

setInterval(() => {
  const ttl = 30 * 60 * 1000;
  const now = Date.now();
  for (const [key, val] of pendingReceipts) {
    if (now - val.createdAt > ttl) pendingReceipts.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Signature Verification ────────────────────────────────────────────────────

function verifySignature(rawBody: string, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', process.env.LINE_CHANNEL_SECRET!)
    .update(rawBody)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ─── Event: Follow ─────────────────────────────────────────────────────────────

async function handleFollowEvent(event: WebhookEvent): Promise<void> {
  if (event.type !== 'follow') return;
  const userId = event.source.userId ?? 'unknown';
  const { replyToken } = event;

  if (!isRegistered(userId)) {
    startRegistration(userId);
    await replyAskName(replyToken);
  } else {
    await replyText(replyToken, `ยินดีต้อนรับกลับมา ${getUserDisplayName(userId)}! 👋\nพิมพ์ /help เพื่อดูเมนู`);
  }
}

// ─── Event: Text Message ───────────────────────────────────────────────────────

async function handleTextMessage(event: WebhookEvent): Promise<void> {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId ?? 'unknown';
  const { replyToken } = event;
  const text = event.message.text.trim();

  // ── Registration flow ──
  const pendingReg = getPendingRegistration(userId);
  if (pendingReg) {
    if (pendingReg.step === 'awaiting_name') {
      if (text.length < 2) {
        await replyText(replyToken, 'กรุณาพิมพ์ชื่อ-นามสกุลของคุณ (อย่างน้อย 2 ตัวอักษร)');
        return;
      }
      advanceRegistration(userId, text);
      await replyAskDepartment(replyToken, text);
      return;
    }

    if (pendingReg.step === 'awaiting_department') {
      const dept = (DEPARTMENTS as readonly string[]).includes(text) ? text : 'ทั่วไป';
      const displayName = pendingReg.displayName ?? text;
      registerUser(userId, displayName, dept);
      await replyRegistrationComplete(replyToken, displayName, dept);
      return;
    }
  }

  // ── Prompt unregistered users ──
  if (!isRegistered(userId)) {
    startRegistration(userId);
    await replyAskName(replyToken);
    return;
  }

  // ── Commands ──
  const cmd = text.toLowerCase();

  if (cmd === '/report' || cmd === 'รายงาน') {
    try {
      const summary = await getMonthSummary();
      const flex = buildMonthlySummaryFlex(summary);
      await replyFlex(replyToken, `รายงานค่าใช้จ่าย ${summary.month}`, flex);
    } catch {
      await replyText(replyToken, 'ขออภัย ไม่สามารถดึงข้อมูลได้ในขณะนี้');
    }
    return;
  }

  if (cmd === '/my' || cmd === 'รายการของฉัน') {
    try {
      const displayName = getUserDisplayName(userId);
      const rows = await getUserRecentExpenses(displayName, 10);
      const flex = buildMyExpensesFlex(rows, displayName);
      await replyFlex(replyToken, `รายการของ ${displayName}`, flex);
    } catch {
      await replyText(replyToken, 'ขออภัย ไม่สามารถดึงข้อมูลได้ในขณะนี้');
    }
    return;
  }

  if (cmd === '/help' || cmd === 'ช่วยเหลือ' || cmd === 'help') {
    await replyText(replyToken, buildHelpText());
    return;
  }

  if (cmd === '/budget' || cmd === 'งบประมาณ') {
    await replyText(
      replyToken,
      '💰 ระบบงบประมาณอยู่ระหว่างพัฒนา\nใช้คำสั่ง /report เพื่อดูยอดค่าใช้จ่ายปัจจุบัน'
    );
    return;
  }

  // ── Default: show help ──
  await replyText(replyToken, buildHelpText());
}

// ─── Event: Image Message ──────────────────────────────────────────────────────

async function handleImageMessage(event: WebhookEvent): Promise<void> {
  if (event.type !== 'message' || event.message.type !== 'image') return;

  const messageId = event.message.id;
  const userId = event.source.userId ?? 'unknown';
  const { replyToken } = event;

  // Prompt unregistered users to register first
  if (!isRegistered(userId)) {
    startRegistration(userId);
    await replyAskName(replyToken);
    return;
  }

  logger.info('Image message received', { messageId, userId });

  const imageBuffer = await downloadLineImage(messageId);
  const receipt = await extractReceiptData(imageBuffer);

  if (receipt.error) {
    await replyText(
      replyToken,
      'ไม่สามารถอ่านเอกสารได้\n\nกรุณาส่งภาพใบเสร็จ, สลิปโอนเงิน หรือบิลค่าใช้จ่ายเท่านั้น'
    );
    return;
  }

  if (receipt.expense_type === 'Group_Tour') {
    pendingReceipts.set(userId, {
      receipt,
      imageMessageId: messageId,
      createdAt: Date.now(),
    });
    await replyFlexTourGroupSelector(replyToken, {
      merchant: receipt.merchant_name,
      amount: receipt.total_amount,
      category: receipt.category,
    });
    return;
  }

  const row: SheetRow = {
    date: receipt.date,
    merchant_name: receipt.merchant_name,
    total_amount: receipt.total_amount,
    category: receipt.category,
    expense_type: receipt.expense_type,
    tour_group: '',
    submitted_by: getUserDisplayName(userId),
    department: getUserDepartment(userId),
    line_message_id: messageId,
    recorded_at: new Date().toISOString(),
  };

  await appendReceiptRow(row);
  await replyText(
    replyToken,
    [
      'บันทึกรายจ่ายเรียบร้อยแล้ว!',
      '─────────────────────',
      `   ร้าน : ${receipt.merchant_name}`,
      `   ยอด  : ฿${receipt.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`,
      `   หมวด : ${receipt.category}`,
    ].join('\n')
  );
}

// ─── Event: Postback ───────────────────────────────────────────────────────────

async function handlePostback(event: WebhookEvent): Promise<void> {
  if (event.type !== 'postback') return;

  const userId = event.source.userId ?? 'unknown';
  const params = new URLSearchParams(event.postback.data);

  if (params.get('action') !== 'select_tour') return;

  const tourGroup = decodeURIComponent(params.get('group') ?? '');
  const pending = pendingReceipts.get(userId);

  if (!pending) {
    await replyText(event.replyToken, 'ไม่พบข้อมูลใบเสร็จที่รอดำเนินการ\nกรุณาส่งภาพใบเสร็จอีกครั้ง');
    return;
  }

  pendingReceipts.delete(userId);

  const { receipt, imageMessageId } = pending;
  const row: SheetRow = {
    date: receipt.date,
    merchant_name: receipt.merchant_name,
    total_amount: receipt.total_amount,
    category: receipt.category,
    expense_type: receipt.expense_type,
    tour_group: tourGroup,
    submitted_by: getUserDisplayName(userId),
    department: getUserDepartment(userId),
    line_message_id: imageMessageId,
    recorded_at: new Date().toISOString(),
  };

  await appendReceiptRow(row);
  await pushConfirmation(userId, {
    merchant: receipt.merchant_name,
    amount: receipt.total_amount,
    category: receipt.category,
    expenseType: receipt.expense_type,
    tourGroup,
  });
}

// ─── Webhook Route ─────────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const signature = req.headers['x-line-signature'] as string | undefined;

  if (!signature) {
    return res.status(400).json({ error: 'Missing X-Line-Signature header' });
  }

  const rawBody: string = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);

  try {
    if (!verifySignature(rawBody, signature)) {
      logger.warn('LINE signature verification failed');
      return res.status(403).json({ error: 'Invalid signature' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // Respond 200 immediately — LINE requires a response within 30 s
  res.status(200).json({ status: 'ok' });

  const { events = [] } = req.body as WebhookRequestBody;

  for (const event of events) {
    try {
      if (event.type === 'follow') {
        await handleFollowEvent(event);
      } else if (event.type === 'message' && event.message.type === 'image') {
        await handleImageMessage(event);
      } else if (event.type === 'message' && event.message.type === 'text') {
        await handleTextMessage(event);
      } else if (event.type === 'postback') {
        await handlePostback(event);
      }
    } catch (err) {
      logger.error(`Error handling ${event.type} event`, err);
    }
  }
});

export default router;
