const DEFAULT_API = 'http://localhost:8787';

export function apiBaseUrl(): string {
  if (import.meta.env.VITE_PUBLIC_API_URL) {
    return String(import.meta.env.VITE_PUBLIC_API_URL).replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location.port === '5173') {
    return '';
  }
  return DEFAULT_API;
}

function authHeaders(sessionToken: string): HeadersInit {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${sessionToken}`,
  };
}

export type MySupportTicket = {
  ticketId: string;
  subject: string;
  status: string;
  urgency: string;
  channel: string;
  messageCount: number;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  createdAt: string;
};

export async function listMySupportTickets(
  sessionToken: string,
  limit = 50,
): Promise<MySupportTicket[]> {
  const res = await fetch(`${apiBaseUrl()}/v1/me/support/tickets?limit=${limit}`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `support_list_failed_${res.status}`);
  }
  const body = (await res.json()) as { tickets: MySupportTicket[] };
  return body.tickets;
}

export async function openMySupportTicket(
  sessionToken: string,
  input: {
    subject: string;
    body: string;
    channel?: 'in_app' | 'whatsapp' | 'phone';
    urgency?: 'general' | 'urgent';
  },
): Promise<{ ticketId: string; tickets?: MySupportTicket[] }> {
  const res = await fetch(`${apiBaseUrl()}/v1/me/support/tickets`, {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `support_open_failed_${res.status}`);
  }
  return (await res.json()) as { ticketId: string; tickets?: MySupportTicket[] };
}

export async function confirmCloseMySupportTicket(
  sessionToken: string,
  ticketId: string,
): Promise<{ tickets?: MySupportTicket[]; status?: string }> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/me/support/tickets/${encodeURIComponent(ticketId)}/confirm-close`,
    {
      method: 'POST',
      headers: authHeaders(sessionToken),
      body: '{}',
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `support_close_failed_${res.status}`);
  }
  return (await res.json()) as { tickets?: MySupportTicket[]; status?: string };
}
