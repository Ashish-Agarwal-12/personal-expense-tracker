import { connection } from 'next/server';
import TrackerApp from '@/components/TrackerApp';

/**
 * The whole tracker is one client-side app; this page just hosts it.
 * `connection()` makes the page render per request, which the per-request CSP nonce (proxy.ts) needs.
 */
export default async function Page() {
  await connection();
  return <TrackerApp />;
}
