import axios from 'axios';
import { messagingApi } from '@line/bot-sdk';
import { TOUR_GROUPS } from '../types';

const LINE_CONTENT_API = 'https://api-data.line.me/v2/bot/message';

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
});

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

// ─── Flex Message: Tour Group Selector ────────────────────────────────────────

export async function replyFlexTourGroupSelector(
  replyToken: string,
  summary: { merchant: string; amount: number; category: string; messageId?: string }
): Promise<void> {
  const amountFormatted = summary.amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Build one button per tour group
  const msgParam = summary.messageId ? `&msgId=${encodeURIComponent(summary.messageId)}` : '';
  const buttons = TOUR_GROUPS.map(
    (group): messagingApi.FlexButton => ({
      type: 'button',
      style: 'primary',
      height: 'sm',
      action: {
        type: 'postback',
        label: group,
        data: `action=select_tour&group=${encodeURIComponent(group)}${msgParam}`,
        displayText: `เลือก: ${group}`,
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
          text: 'ค่าใช้จ่ายกรุ๊ปทัวร์',
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
          text: 'ค่าใช้จ่ายนี้เป็นของกรุ๊ปทัวร์ไหน?',
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
        altText: `ค่าใช้จ่ายกรุ๊ปทัวร์: ${summary.merchant} ฿${amountFormatted} — กรุณาเลือกกรุ๊ป`,
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
    expenseType: string;
    tourGroup?: string;
  }
): Promise<void> {
  const amountFormatted = data.amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const tourLine = data.tourGroup ? `\n   กรุ๊ป : ${data.tourGroup}` : '';
  const text = [
    'บันทึกรายจ่ายเรียบร้อยแล้ว!',
    '─────────────────────',
    `   ร้าน : ${data.merchant}`,
    `   ยอด  : ฿${amountFormatted}`,
    `   หมวด : ${data.category}`,
    `   ประเภท: ${data.expenseType}${tourLine}`,
  ].join('\n');

  await client.pushMessage({ to: userId, messages: [{ type: 'text', text }] });
}
