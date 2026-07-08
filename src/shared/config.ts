export const DASHBOARD_URL =
  import.meta.env.VITE_DASHBOARD_URL || 'https://app.studypilot.ai/sessions';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const STUDYPILOT_CONNECT_MESSAGE =
  'StudyPilot is not connected yet. Open the dashboard, sign in, then connect the extension session.';
