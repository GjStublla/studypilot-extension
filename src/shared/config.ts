export const DASHBOARD_URL =
  import.meta.env.VITE_DASHBOARD_URL || 'https://app.studypilot.ai/sessions';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * Temporary development switch: when false, the extension treats itself as
 * connected without a dashboard session so the panel is usable in local/dev.
 *
 * Flip back to `true` before production launch.
 */
export const AUTH_REQUIRED = false;

export const STUDYPILOT_CONNECT_MESSAGE =
  'StudyPilot is not connected yet. Open the dashboard, sign in, then connect the extension session.';
