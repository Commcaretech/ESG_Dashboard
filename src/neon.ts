import {createClient} from '@neon/neon-js';
import {BetterAuthReactAdapter} from '@neon/neon-js/auth/react/adapters';

function endpoint(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
  } catch {
    return null;
  }
}

function connect(authUrl: string, dataUrl: string) {
  return createClient({
    auth: {url: authUrl, adapter: BetterAuthReactAdapter(), allowAnonymous: false},
    dataApi: {url: dataUrl},
  });
}

const authUrl = endpoint(import.meta.env.VITE_NEON_AUTH_URL);
const dataUrl = endpoint(import.meta.env.VITE_NEON_DATA_API_URL);
export const client = authUrl && dataUrl ? connect(authUrl, dataUrl) : null;
export type ReportingClient = ReturnType<typeof connect>;
