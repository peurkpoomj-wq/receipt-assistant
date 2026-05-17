export interface ExtractedReceipt {
  date: string;
  merchant_name: string;
  total_amount: number;
  category: 'อาหารและเครื่องดื่ม' | 'อุปกรณ์สำนักงาน' | 'เดินทางและที่พัก' | 'จิปาถะ';
  error?: string;
}

export interface PendingReceipt {
  receipt: ExtractedReceipt;
  imageMessageId: string;
  createdAt: number;
}

export const DEFAULT_COST_CENTERS = [
  'ทั่วไป',
  'แผนกขาย',
  'แผนกการตลาด',
  'แผนกปฏิบัติการ',
  'แผนกบัญชี',
] as const;

export interface SheetRow {
  date: string;
  merchant_name: string;
  total_amount: number;
  category: string;
  cost_center: string;
  line_message_id: string;
  recorded_at: string;
}
