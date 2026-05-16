import { getSupabase } from './supabase';
import { Tenant, DEFAULT_TOUR_GROUPS } from '../types';
import { logger } from '../utils/logger';

export async function getTenantById(id: string): Promise<Tenant | null> {
  const { data, error } = await getSupabase()
    .from('tenants')
    .select('*')
    .eq('id', id)
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    logger.error('getTenantById error', { id, error });
    throw error;
  }

  return data as Tenant;
}

export async function getAllActiveTenants(): Promise<Tenant[]> {
  const { data, error } = await getSupabase()
    .from('tenants')
    .select('*')
    .eq('is_active', true);

  if (error) {
    logger.error('getAllActiveTenants error', { error });
    throw error;
  }

  return (data ?? []) as Tenant[];
}

export async function createTenant(input: {
  name: string;
  line_channel_secret: string;
  line_channel_access_token: string;
  google_oauth_client_id: string;
  google_oauth_client_secret: string;
  google_oauth_refresh_token: string;
  spreadsheet_id: string;
  sheet_name?: string;
  tour_groups?: string[];
  plan?: Tenant['plan'];
}): Promise<Tenant> {
  const { data, error } = await getSupabase()
    .from('tenants')
    .insert({
      name: input.name,
      line_channel_secret: input.line_channel_secret,
      line_channel_access_token: input.line_channel_access_token,
      google_oauth_client_id: input.google_oauth_client_id,
      google_oauth_client_secret: input.google_oauth_client_secret,
      google_oauth_refresh_token: input.google_oauth_refresh_token,
      spreadsheet_id: input.spreadsheet_id,
      sheet_name: input.sheet_name ?? 'Expenses',
      tour_groups: input.tour_groups ?? [...DEFAULT_TOUR_GROUPS],
      plan: input.plan ?? 'free',
      monthly_receipt_count: 0,
      monthly_reset_at: new Date().toISOString(),
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    logger.error('createTenant error', { error });
    throw error;
  }

  logger.info('Tenant created', { id: data.id, name: input.name });
  return data as Tenant;
}

export async function incrementReceiptCount(tenantId: string): Promise<void> {
  const { error } = await getSupabase().rpc('increment_receipt_count', {
    tenant_id: tenantId,
  });

  if (error) {
    logger.warn('incrementReceiptCount error', { tenantId, error });
    // Non-fatal — don't throw
  }
}

export async function updateTenant(
  id: string,
  updates: Partial<Omit<Tenant, 'id' | 'created_at'>>
): Promise<void> {
  const { error } = await getSupabase()
    .from('tenants')
    .update(updates)
    .eq('id', id);

  if (error) {
    logger.error('updateTenant error', { id, error });
    throw error;
  }
}
