import { messagingApi } from '@line/bot-sdk';
import { MonthSummary, DaySummary, SheetRow } from '../types';

const CATEGORY_ICON: Record<string, string> = {
  'อาหารและเครื่องดื่ม': '🍽',
  'อุปกรณ์สำนักงาน': '📦',
  'เดินทางและที่พัก': '✈️',
  'จิปาถะ': '📋',
};

function fmt(amount: number): string {
  return amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Monthly Summary Flex Bubble ──────────────────────────────────────────────

export function buildMonthlySummaryFlex(summary: MonthSummary): messagingApi.FlexBubble {
  const categoryRows: messagingApi.FlexComponent[] = Object.entries(summary.byCategory).map(
    ([cat, amount]): messagingApi.FlexBox => ({
      type: 'box',
      layout: 'horizontal',
      margin: 'sm',
      contents: [
        {
          type: 'text',
          text: `${CATEGORY_ICON[cat] ?? '•'} ${cat}`,
          size: 'sm',
          color: '#555555',
          flex: 4,
          wrap: true,
        } as messagingApi.FlexText,
        {
          type: 'text',
          text: `฿${fmt(amount)}`,
          size: 'sm',
          color: '#111111',
          align: 'end',
          flex: 3,
        } as messagingApi.FlexText,
      ],
    })
  );

  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1A73E8',
      paddingAll: 'lg',
      contents: [
        {
          type: 'text',
          text: '📊 รายงานค่าใช้จ่าย',
          weight: 'bold',
          color: '#FFFFFF',
          size: 'lg',
        } as messagingApi.FlexText,
        {
          type: 'text',
          text: summary.month,
          color: '#CCDDFF',
          size: 'sm',
          margin: 'xs',
        } as messagingApi.FlexText,
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'lg',
      spacing: 'md',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'ยอดรวมทั้งหมด', size: 'sm', color: '#888888', flex: 2 } as messagingApi.FlexText,
            {
              type: 'text',
              text: `฿${fmt(summary.totalAmount)}`,
              size: 'xl',
              weight: 'bold',
              color: '#1A73E8',
              align: 'end',
              flex: 3,
            } as messagingApi.FlexText,
          ],
        } as messagingApi.FlexBox,
        {
          type: 'text',
          text: `${summary.transactionCount} รายการ`,
          size: 'xs',
          color: '#AAAAAA',
        } as messagingApi.FlexText,
        { type: 'separator', margin: 'md' } as messagingApi.FlexSeparator,
        {
          type: 'text',
          text: 'แบ่งตามหมวดหมู่',
          size: 'sm',
          weight: 'bold',
          color: '#333333',
          margin: 'md',
        } as messagingApi.FlexText,
        ...categoryRows,
      ],
    },
  };
}

// ─── My Expenses Flex Carousel ────────────────────────────────────────────────

export function buildMyExpensesFlex(
  rows: SheetRow[],
  displayName: string
): messagingApi.FlexCarousel | messagingApi.FlexBubble {
  if (rows.length === 0) {
    return {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `ไม่พบรายการของ ${displayName}`, size: 'md', color: '#888888', align: 'center' } as messagingApi.FlexText,
        ],
      },
    };
  }

  // Build a single bubble listing up to 10 rows
  const items: messagingApi.FlexComponent[] = rows.map(
    (r): messagingApi.FlexBox => ({
      type: 'box',
      layout: 'horizontal',
      margin: 'sm',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          flex: 4,
          contents: [
            { type: 'text', text: r.merchant_name, size: 'sm', weight: 'bold', wrap: true, maxLines: 1 } as messagingApi.FlexText,
            { type: 'text', text: `${r.date}  ${r.category}`, size: 'xxs', color: '#999999', wrap: true } as messagingApi.FlexText,
          ],
        } as messagingApi.FlexBox,
        {
          type: 'text',
          text: `฿${fmt(r.total_amount)}`,
          size: 'sm',
          weight: 'bold',
          color: '#1A73E8',
          align: 'end',
          flex: 3,
        } as messagingApi.FlexText,
      ],
    })
  );

  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#1A73E8',
      paddingAll: 'md',
      contents: [
        {
          type: 'text',
          text: `📋 รายการของ ${displayName}`,
          weight: 'bold',
          color: '#FFFFFF',
          size: 'md',
        } as messagingApi.FlexText,
        {
          type: 'text',
          text: `${rows.length} รายการล่าสุด`,
          color: '#CCDDFF',
          size: 'xs',
          margin: 'xs',
        } as messagingApi.FlexText,
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'md',
      spacing: 'none',
      contents: items,
    },
  };
}

// ─── Daily Flash Text ─────────────────────────────────────────────────────────

export function buildDailyFlashText(summary: MonthSummary, today: DaySummary): string {
  const now = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines = [
    `📊 Flash Report ${now}`,
    `──────────────────────`,
    `วันนี้: ${today.count} รายการ  ฿${fmt(today.total)}`,
    `เดือนนี้รวม: ฿${fmt(summary.totalAmount)} (${summary.transactionCount} รายการ)`,
    `──────────────────────`,
  ];
  for (const [cat, amount] of Object.entries(summary.byCategory)) {
    lines.push(`${CATEGORY_ICON[cat] ?? '•'} ${cat}: ฿${fmt(amount)}`);
  }
  return lines.join('\n');
}

// ─── Help Text ────────────────────────────────────────────────────────────────

export function buildHelpText(): string {
  return [
    '📖 วิธีใช้งาน Receipt Assistant',
    '──────────────────────────────',
    '📷 ส่งรูปใบเสร็จ → บันทึกอัตโนมัติ',
    '',
    '📌 คำสั่งที่ใช้ได้:',
    '  /report  — รายงานค่าใช้จ่ายเดือนนี้',
    '  /my      — รายการล่าสุดของคุณ',
    '  /help    — คู่มือการใช้งาน',
    '',
    '💡 หมวดหมู่ที่รองรับ:',
    '  🍽 อาหารและเครื่องดื่ม',
    '  📦 อุปกรณ์สำนักงาน',
    '  ✈️ เดินทางและที่พัก',
    '  📋 จิปาถะ',
  ].join('\n');
}
