function resolveDashboardUrl() {
  const configured = import.meta.env.VITE_DASHBOARD_URL?.trim();
  if (configured) return configured;

  const localCandidates = ['http://localhost:5173/sessions', 'http://127.0.0.1:5173/sessions'];

  return (
    localCandidates.find((candidate) => {
      try {
        return new URL(candidate).hostname === 'localhost' || new URL(candidate).hostname === '127.0.0.1';
      } catch {
        return false;
      }
    }) ?? 'https://app.studypilot.ai/sessions'
  );
}

export const DASHBOARD_URL = resolveDashboardUrl();

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const LOCAL_DEV_EMAIL = 'dev@studypilot.local';
export const LOCAL_DEV_PASSWORD = 'StudyPilot-local-dev-only-2026!';

export function isLoopbackUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const { hostname, protocol } = new URL(value);
    return (
      (protocol === 'http:' || protocol === 'https:') &&
      (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

const localModeRequested = import.meta.env.MODE === 'studypilot-local';
const localEndpointsConfigured = isLoopbackUrl(SUPABASE_URL) && isLoopbackUrl(DASHBOARD_URL);

export const LOCAL_DEV_MODE = localModeRequested && localEndpointsConfigured;

export const STUDYPILOT_CONNECT_MESSAGE =
  'StudyPilot is not connected yet. Sign in once to connect the extension and dashboard.';
