const DEFAULT_API = 'http://localhost:8787';

export function apiBaseUrl(): string {
  if (import.meta.env.VITE_PUBLIC_API_URL) {
    return String(import.meta.env.VITE_PUBLIC_API_URL).replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location.port === '5174') {
    return '';
  }
  return DEFAULT_API;
}

export type IssuedInvite = {
  id: string;
  inviteCode: string;
  intendedRole: string;
  maxUses: number;
  useCount: number;
  note?: string | null;
};

export type IssuedStore = {
  id: string;
  code: string;
  name: string;
  status: string;
};

export async function createInvite(input: {
  inviteCode: string;
  intendedRole: string;
  maxUses: number;
  note?: string;
}): Promise<IssuedInvite> {
  const res = await fetch(`${apiBaseUrl()}/v1/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `invite_create_failed_${res.status}`);
  }
  const body = (await res.json()) as { invite: IssuedInvite };
  return body.invite;
}

export async function listInvites(): Promise<IssuedInvite[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/invites`);
  if (!res.ok) {
    throw new Error(`invite_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { invites: IssuedInvite[] };
  return body.invites;
}

export async function createStoreDraft(input: {
  name: string;
  code?: string;
}): Promise<IssuedStore> {
  const res = await fetch(`${apiBaseUrl()}/v1/stores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `store_create_failed_${res.status}`);
  }
  const body = (await res.json()) as { store: IssuedStore };
  return body.store;
}

export async function listStores(): Promise<IssuedStore[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/stores`);
  if (!res.ok) {
    throw new Error(`store_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { stores: IssuedStore[] };
  return body.stores;
}
