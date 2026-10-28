import { createHandler } from './handler.js';

const url = Deno.env.get('SUPABASE_URL');
const publicKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
const serverKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const serverKey = serverKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

async function rpc(name, args) {
  if (!url || !serverKey) throw new Error('server_configuration');
  const headers = { apikey: serverKey, 'Content-Type': 'application/json' };
  if (!serverKey.startsWith('sb_secret_')) headers.Authorization = `Bearer ${serverKey}`;
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) });
  if (!response.ok) throw new Error('storage');
  return response.json();
}

Deno.serve(createHandler({ callerApiKey: publicKeys.default, rpc }));
