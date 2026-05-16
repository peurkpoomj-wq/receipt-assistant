// ─── Receipt & Sheets ────────────────────────────────────────────────────────

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

// ─── Tenant (Multi-Tenant SaaS) ───────────────────────────────────────────────

export interface Tenant {
  id: string;                        // UUID — used in webhook URL
  name: string;                      // Company name
  line_channel_secret: string;
  line_channel_access_token: string;
  google_oauth_client_id: string;
  google_oauth_client_secret: string;
  google_oauth_refresh_token: string;
  spreadsheet_id: string;
  sheet_name: string;                // default: 'Expenses'
  tour_groups: string[];             // customizable per tenant
  plan: 'free' | 'pro' | 'business';
  monthly_receipt_count: number;
  monthly_reset_at: string;
  is_active: boolean;
  created_at: string;
}

export const DEFAULT_TOUR_GROUPS = [
  'กรุ๊ปญี่ปุ่น',
  'กรุ๊ปเกาหลี',
  'กรุ๊ปยุโรป',
  'กรุ๊ปจีน',
  'กรุ๊ปออสเตรเลีย',
] as const;

export const PLAN_LIMITS: Record<Tenant['plan'], number> = {
  free: 50,
  pro: 500,
  business: Infinity,
};
