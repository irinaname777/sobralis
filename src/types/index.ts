export type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_emoji: string | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
};

export type Group = {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
};

export type GroupMember = {
  id: string;
  group_id: string;
  user_id: string;
  role: string;
  display_name: string | null;
  avatar_emoji: string | null;
  status?: 'invited' | 'accepted' | 'active' | 'removed';
  created_at: string;
};

export type GroupInvitation = {
  id: string;
  group_id: string;
  invite_code: string;
  created_by: string;
  expires_at: string | null;
  used_by: string | null;
  created_at: string;
};

export type CycleSettings = {
  id: string;
  user_id: string;
  tracking_enabled: boolean;
  last_period_start: string | null;
  average_cycle_length: number;
  period_length: number;
  privacy_level: 'full' | 'comfort' | 'hidden';
  created_at: string;
  updated_at: string;
};

export type EventCoordinationStatus = 'pending' | 'confirmed' | 'cancelled';

export type Meeting = {
  id: string;
  group_id: string;
  title: string;
  meeting_date: string;
  meeting_time: string | null;
  location: string | null;
  description: string | null;
  created_by: string;
  status?: EventCoordinationStatus;
  created_at: string;
  updated_at: string;
};

export type MeetingParticipant = {
  id: string;
  meeting_id: string;
  user_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'counter_proposed';
  counter_date: string | null;
  counter_time: string | null;
  counter_location: string | null;
  created_at: string;
};

export type Trip = {
  id: string;
  group_id: string;
  title: string;
  destination: string | null;
  start_date: string;
  end_date: string;
  notes: string | null;
  created_by: string;
  status?: EventCoordinationStatus;
  created_at: string;
  updated_at: string;
};

export type TripParticipant = {
  id: string;
  trip_id: string;
  user_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'counter_proposed';
  counter_date: string | null;
  counter_start_date?: string | null;
  counter_end_date?: string | null;
  counter_location: string | null;
  created_at: string;
};

export type Expense = {
  id: string;
  group_id: string;
  title: string;
  amount: number;
  expense_date: string;
  paid_by: string;
  split_method: 'equal' | 'manual';
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ExpenseParticipant = {
  id: string;
  expense_id: string;
  user_id: string;
  share_amount: number;
  created_at: string;
};

export type ExpenseObligation = {
  id: string; expense_id: string; debtor_id: string; creditor_id: string; amount: number;
  pending_payment_amount: number | null;
  status: 'unpaid' | 'payment_pending_confirmation' | 'settled' | 'archived';
  marked_at: string | null; confirmed_at: string | null;
};

export type PrivacyLevel = 'full' | 'comfort' | 'hidden';
