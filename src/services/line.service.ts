import axios from 'axios';
import { messagingApi } from '@line/bot-sdk';
import { DEFAULT_COST_CENTERS } from '../types';

const LINE_CONTENT_API = 'https://api-data.line.me/v2/bot/message';

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
});

// ─── Cost Centers — from env var or defaults ───────────────────────────────────

export function getCostCenters(): string[] {
  const raw = process.env.COST_CENTERS;
  if (raw) {
    const parsed = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (parsed.length > 0) return parsed;
  }
  return [...DEFAULT_COST_CENTERS];
}

// ─── Image Download ────────────────────────────────────────────────────────────

export async function downloadLineImage(messageId: string): Promise<Buffer> {
  const res = await axios.get(`${LINE_CONTENT_API}/${messageId}/content`, {
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
    responseType: 'arraybuffer',
    timeout: 15_000,
  });
  return Buffer.from(res.data as ArrayBuffer);
}

// ─── Reply Helpers ─────────────────────────────────────────────────────────────

export async function replyText(replyToken: string, text: string): Promise<void> {
  await client.replyMessage({
    replyToken,
    messages: [{ type: 'text', text }],
  });
}

// ─── Flex Message: Cost Center Selector ───────────────────────────────────────

export async function replyFlexCostCenterSelector(
  replyToken: string,
  summary: {
    merchant: string;
    amount: number;
    category: string;
    messageId?: string;
    costCenters: string[];
  }
): Promise<void> {
  const amountFormatted = summary.amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const msgParam = summary.messageId ? `&msgId=${encodeURIComponent(summary.messageId)}` : '';
  const buttons = summary.costCenters.map(
    (center): messagingApi.FlexButton => ({
      type: 'button',
      style: 'primary',
      height: 'sm',
      action: {
        type: 'postback',
        label: center,
        data: `action=select_cost_center&center=${encodeURIComponent(center)}${msgParam}`,
        displayText: `เลือก: ${center}`,
      },
    })
  );

  const bubble: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1DB446',
      paddingAll: 'md',
      contents: [
        {
          type: 'text',
          text: '📂 เลือก Cost Center',
          weight: 'bold',
          size: 'lg',
          color: '#FFFFFF',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: 'md',
      contents: [
        {
          type: 'text',
          text: summary.merchant,
          weight: 'bold',
          size: 'md',
          wrap: true,
          maxLines: 2,
        },
        {
          type: 'text',
          text: `฿${amountFormatted}`,
          size: 'xxl',
          weight: 'bold',
          color: '#1DB446',
        },
        {
          type: 'text',
          text: `หมวด: ${summary.category}`,
          size: 'sm',
          color: '#888888',
        },
        { type: 'separator', margin: 'md' },
        {
          type: 'text',
          text: 'ค่าใช้จ่ายนี้อยู่ใน Cost Center ไหน?',
          size: 'sm',
          margin: 'md',
          wrap: true,
          color: '#555555',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: 'md',
      contents: buttons,
    },
  };

  await client.replyMessage({
    replyToken,
    messages: [
      {
        type: 'flex',
        altText: `เลือก Cost Center: ${summary.merchant} ฿${amountFormatted}`,
        contents: bubble,
      },
    ],
  });
}

// ─── Push Confirmation ─────────────────────────────────────────────────────────

export async function pushConfirmation(
  userId: string,
  data: {
    merchant: string;
    amount: number;
    category: string;
    costCenter: string;
  }
): Promise<void> {
  const amountFormatted = data.amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const text = [
    '✅ บันทึกรายจ่ายเรียบร้อยแล้ว!',
    '─────────────────────',
    `   ร้าน       : ${data.merchant}`,
    `   ยอด        : ฿${amountFormatted}`,
    `   หมวด       : ${data.category}`,
    `   Cost Center: ${data.costCenter}`,
  ].join('\n');

  await client.pushMessage({ to: userId, messages: [{ type: 'text', text }] });
}
