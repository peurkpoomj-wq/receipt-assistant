import axios from 'axios';
import { messagingApi } from '@line/bot-sdk';
import { DEFAULT_COST_CENTERS, MonthlyReport } from '../types';

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
    transactionType?: string;
  }
): Promise<void> {
  const amountFormatted = data.amount.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const typeIcon = data.transactionType === 'รายรับ' ? '💚' : '🔴';
  const text = [
    `${typeIcon} บันทึก${data.transactionType ?? 'รายจ่าย'}เรียบร้อยแล้ว!`,
    '─────────────────────',
    `   ร้าน/จาก   : ${data.merchant}`,
    `   ยอด        : ฿${amountFormatted}`,
    `   หมวด       : ${data.category}`,
    `   Cost Center: ${data.costCenter}`,
  ].join('\n');

  await client.pushMessage({ to: userId, messages: [{ type: 'text', text }] });
}

// ─── Monthly Dashboard Flex Message ───────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function replyDashboard(replyToken: string, report: MonthlyReport): Promise<void> {
  // Build group rows (max 5 to avoid LINE bubble size limit)
  const groupContents: messagingApi.FlexComponent[] = [];

  const topGroups = report.groups.slice(0, 5);

  for (const g of topGroups) {
    const netColor = g.net >= 0 ? '#00C853' : '#E53935';
    groupContents.push(
      { type: 'separator', margin: 'md' } as messagingApi.FlexSeparator,
      {
        type: 'box',
        layout: 'vertical',
        margin: 'md',
        spacing: 'xs',
        contents: [
          {
            type: 'text',
            text: `📁 ${g.name}`,
            weight: 'bold',
            size: 'sm',
            color: '#333333',
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: `💚 รับ ฿${fmt(g.income)}`, size: 'xs', color: '#00C853', flex: 1 },
              { type: 'text', text: `🔴 จ่าย ฿${fmt(g.expense)}`, size: 'xs', color: '#E53935', flex: 1 },
            ],
          },
          {
            type: 'text',
            text: `สุทธิ: ฿${fmt(g.net)}`,
            size: 'xs',
            color: netColor,
            weight: 'bold',
          },
        ],
      } as messagingApi.FlexBox,
    );
  }

  if (report.groups.length > 5) {
    groupContents.push({
      type: 'text',
      text: `+ อีก ${report.groups.length - 5} กรุ๊ป`,
      size: 'xs',
      color: '#888888',
      margin: 'sm',
    } as messagingApi.FlexText);
  }

  const overallNetColor = report.net >= 0 ? '#00C853' : '#E53935';

  const bubble: messagingApi.FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1565C0',
      paddingAll: 'md',
      contents: [
        { type: 'text', text: '📊 รายงานประจำเดือน', weight: 'bold', size: 'lg', color: '#FFFFFF' },
        { type: 'text', text: report.month, size: 'sm', color: '#B3D4FF' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'md',
      contents: [
        // Summary box
        {
          type: 'box',
          layout: 'horizontal',
          backgroundColor: '#F5F5F5',
          cornerRadius: 'md',
          paddingAll: 'sm',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              flex: 1,
              contents: [
                { type: 'text', text: '💚 รายรับรวม', size: 'xs', color: '#555555' },
                { type: 'text', text: `฿${fmt(report.totalIncome)}`, weight: 'bold', size: 'md', color: '#00C853' },
              ],
            },
            {
              type: 'box',
              layout: 'vertical',
              flex: 1,
              contents: [
                { type: 'text', text: '🔴 รายจ่ายรวม', size: 'xs', color: '#555555' },
                { type: 'text', text: `฿${fmt(report.totalExpense)}`, weight: 'bold', size: 'md', color: '#E53935' },
              ],
            },
          ],
        } as messagingApi.FlexBox,
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'sm',
          contents: [
            { type: 'text', text: 'กำไรสุทธิ:', weight: 'bold', size: 'sm', flex: 1 },
            { type: 'text', text: `฿${fmt(report.net)}`, weight: 'bold', size: 'sm', color: overallNetColor, align: 'end' },
          ],
        } as messagingApi.FlexBox,
        // Group breakdown
        ...groupContents,
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'sm',
      contents: [
        {
          type: 'text',
          text: `รวม ${report.groups.reduce((s, g) => s + g.count, 0)} รายการ • พิมพ์ "รายงาน" เพื่อดูใหม่`,
          size: 'xxs',
          color: '#AAAAAA',
          align: 'center',
          wrap: true,
        },
      ],
    },
  };

  await client.replyMessage({
    replyToken,
    messages: [
      {
        type: 'flex',
        altText: `📊 รายงาน ${report.month} | รับ ฿${fmt(report.totalIncome)} | จ่าย ฿${fmt(report.totalExpense)}`,
        contents: bubble,
      },
    ],
  });
}
