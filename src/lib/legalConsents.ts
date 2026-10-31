import { supabase } from '@/lib/supabase';
import { findLegalDocument } from '@/lib/legalDocuments';

export const SIGNUP_CONSENT_METADATA_KEY = 'sobralis_consents';

export async function hasCurrentHealthDataConsent(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('legal_consent_events')
    .select('decision, document_sha256')
    .eq('user_id', userId)
    .eq('consent_type', 'health_data')
    .order('recorded_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.decision === 'granted'
    && data.document_sha256 === findLegalDocument('health-data-consent')?.sha256;
}

export async function setHealthDataConsent(granted: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_health_data_consent', {
    _granted: granted,
  });

  if (error) throw error;
}

export async function saveCycleSettings(settings: {
  trackingEnabled: boolean;
  lastPeriodStart: string | null;
  averageCycleLength: number;
  periodLength: number;
  privacyLevel: string;
}): Promise<void> {
  const { error } = await supabase.rpc('save_cycle_settings', {
    _tracking_enabled: settings.trackingEnabled,
    _last_period_start: settings.lastPeriodStart,
    _average_cycle_length: settings.averageCycleLength,
    _period_length: settings.periodLength,
    _privacy_level: settings.privacyLevel,
  });

  if (error) throw error;
}
