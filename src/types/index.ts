export interface ExtractedReceipt {
  date: string;
  merchant_name: string;
  total_amount: number;
  category: 'อาหารและเครื่องดื่ม' | 'อุปกรณ์สำนักงาน' | 'เดินทางและที่พัก' | 'จิปาถะ';
  expense_type: 'Office' | 'Group_Tour';
  error?: string;
}

export interface PendingReceipt {
  receipt: ExtractedReceipt;
  imageMessageId: string;
  createdAt: number;
}

export const TOUR_GROUPS = [
  'กรุ๊ปญี่ปุ่น',
  'กรุ๊ปเกาหลี',
  'กรุ๊ปยุโรป',
  'กรุ๊ปจีน',
  'กรุ๊ปออสเตรเลีย',
] as const;

export type TourGroup = (typeof TOUR_GROUPS)[number];

export interface SheetRow {
  date: string;
  merchant_name: string;
  total_amount: number;
  category: string;
  expense_type: string;
  tour_group: string;
  line_message_id: string;
  recorded_at: string;
}
