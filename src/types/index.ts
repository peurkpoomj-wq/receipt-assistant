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

export const DEPARTMENTS = [
  'ฝ่ายขาย',
  'ฝ่ายการเงิน',
  'ฝ่ายบริการ',
  'ฝ่ายปฏิบัติการ',
  'ฝ่ายบริหาร',
  'ทั่วไป',
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export interface SheetRow {
  date: string;
  merchant_name: string;
  total_amount: number;
  category: string;
  expense_type: string;
  tour_group: string;
  submitted_by: string;
  department: string;
  line_message_id: string;
  recorded_at: string;
}

export interface UserProfile {
  userId: string;
  displayName: string;
  department: string;
  registeredAt: string;
}

export interface PendingRegistration {
  step: 'awaiting_name' | 'awaiting_department';
  displayName?: string;
  createdAt: number;
}

export interface MonthSummary {
  month: string;
  totalAmount: number;
  transactionCount: number;
  byCategory: Record<string, number>;
}

export interface DaySummary {
  count: number;
  total: number;
}
