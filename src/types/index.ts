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

// Default cost centers — override via COST_CENTERS env var (comma-separated)
export const DEFAULT_COST_CENTERS = [
  'กรุ๊ปญี่ปุ่น',
  'กรุ๊ปเกาหลี',
  'กรุ๊ปยุโรป',
  'กรุ๊ปจีน',
  'กรุ๊ปออสเตรเลีย',
  'Office',
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
