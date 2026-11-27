import type {SupabaseClient} from '@supabase/supabase-js';

export type AdminClient = SupabaseClient;
export type GetAdminClient = () => Promise<AdminClient>;

export type AdminStatus = {is_admin: boolean; requires_mfa: boolean};
export type PilotInvitation = {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  delivery_status: string | null;
};
export type PilotRequest = {
  id: string;
  name: string;
  email: string;
  heard_from: string | null;
  pilot_interest: string | null;
  message?: string | null;
  received_at: string;
  status: string;
};
export type DashboardSnapshot = {
  requests: PilotRequest[];
  invitations: PilotInvitation[];
  capacity: {used: number; total: number};
};

export async function getAdminStatus(adminClient: AdminClient): Promise<AdminStatus> {
  const {data, error} = await adminClient.rpc('hh_admin_status');
  if (error || typeof data?.is_admin !== 'boolean' || typeof data.requires_mfa !== 'boolean') {
    throw Error('Admin access could not be checked. Try signing in again.');
  }
  return data;
}

export async function getDashboard(adminClient: AdminClient): Promise<DashboardSnapshot> {
  const {data, error} = await adminClient.rpc('hh_admin_dashboard', {action: 'snapshot'});
  if (error || !Array.isArray(data?.requests) || !Array.isArray(data?.invitations) || !data.capacity) {
    throw Error('The dashboard could not be loaded. Refresh or sign in again.');
  }
  return data;
}

export async function createPilotInvitation(adminClient: AdminClient, email: string): Promise<string> {
  const {data, error} = await adminClient.rpc('hh_admin_dashboard', {action: 'create_invite', payload: {email}});
  if (typeof data?.token === 'string' && /^[0-9a-f]{64}$/.test(data.token)) return data.token;
  const message = error?.message.toLowerCase() ?? '';
  if (/already|duplicate/.test(message)) throw Error('This address already has a pilot invitation or account. Check the invitation list.');
  if (/full|limit|capacity|places/.test(message)) throw Error('All pilot places are currently reserved. Review your invitations before trying again.');
  throw Error('The invitation could not be created. Refresh the list before trying again.');
}

export async function sendPilotInvitation(adminClient: AdminClient, token: string): Promise<boolean> {
  const {data: auth} = await adminClient.auth.getSession();
  if (!auth.session) return false;
  const invoke = (accessToken: string) => adminClient.functions.invoke('invitation-email', {
    body: {action: 'send', kind: 'pilot', token, siteAdmin: true},
    headers: {Authorization: `Bearer ${accessToken}`},
  });
  let response = await invoke(auth.session.access_token);
  if (response.error?.context?.status === 401) {
    const {data, error} = await adminClient.auth.refreshSession();
    if (error || data.session?.user.id !== auth.session.user.id) return false;
    response = await invoke(data.session.access_token);
  }
  return !response.error && response.data?.sent === true;
}

export const familyAppUrl = new URL(window.location.pathname.endsWith('/') ? '../' : './', window.location.href);

export function pilotInvitationUrl(token: string): string {
  const url = new URL(familyAppUrl);
  url.searchParams.set('pilot', token);
  return url.href;
}
