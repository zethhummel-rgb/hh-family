import {useEffect, useState, type ReactNode} from 'react';
import {accountStorage, accountSwitchBlocked, currentAccountStorage, isCurrentAuthClient, supabase} from '../supabase';
import {familyAppUrl, getAdminStatus, type AdminClient, type GetAdminClient} from './api';

type Access = {userId: string; getClient: GetAdminClient};
type Verification = {userId: string; client: AdminClient; recheck: () => Promise<void>};
type Gate =
  | {status: 'checking' | 'blocked'; message?: string}
  | {status: 'verify'; verification: Verification}
  | {status: 'ready'; access: Access};

export default function SharedSession({children, verify}: {
  children: (access: Access) => ReactNode; verify: (verification: Verification) => ReactNode;
}) {
  const [gate, setGate] = useState<Gate>({status: 'checking'});

  useEffect(() => {
    const client = supabase;
    let active = true;
    let revision = 0;
    let approvedId: string | undefined;
    let scheduled: number | undefined;

    function block(message: string) {
      revision++;
      approvedId = undefined;
      if (active) setGate({status: 'blocked', message});
    }

    function isCurrentSignIn() {
      if (!isCurrentAuthClient(client) || accountSwitchBlocked) return false;
      const tab = accountStorage.selectedTab();
      const selected = currentAccountStorage();
      return !tab || (tab.key === selected.key && tab.remember === selected.remember && tab.userId === selected.userId && tab.email === selected.email);
    }

    const currentSignIn = async () => {
      if (!isCurrentSignIn()) return null;
      const {data, error} = await client.auth.getSession();
      const session = data.session;
      const selected = currentAccountStorage();
      if (error || !session || !isCurrentSignIn()) return null;
      if (selected.userId && (session.user.id !== selected.userId || session.user.email?.toLowerCase() !== selected.email)) return null;
      return session.user;
    };

    async function checkAccess() {
      const check = ++revision;
      const current = () => active && check === revision;
      try {
        const sessionUser = await currentSignIn();
        if (!current()) return;
        if (!sessionUser) return block('Sign in to HH to open the dashboard.');
        if (approvedId && approvedId !== sessionUser.id) {
          approvedId = undefined;
          setGate({status: 'checking'});
        }
        const {data, error} = await client.auth.getUser();
        if (!current()) return;
        if (error || data.user?.id !== sessionUser.id || !data.user.email_confirmed_at) {
          return block('HH could not verify your current sign-in. Open HH and try again.');
        }
        const status = await getAdminStatus(client);
        const latest = await currentSignIn();
        if (!current()) return;
        if (latest?.id !== sessionUser.id || !status.is_admin) return block('Your current HH account does not have admin access.');
        if (status.requires_mfa) {
          approvedId = undefined;
          setGate({status: 'verify', verification: {userId: sessionUser.id, client, recheck: checkAccess}});
          return;
        }

        const userId = sessionUser.id;
        if (approvedId === userId) return;
        approvedId = userId;
        const getClient = async () => {
          const next = await currentSignIn();
          if (!active || approvedId !== userId || next?.id !== userId) {
            if (active) block('Your HH sign-in has changed. Open HH to continue.');
            throw Error('Your HH sign-in has changed.');
          }
          return client;
        };
        setGate({status: 'ready', access: {userId, getClient}});
      } catch {
        if (current()) block('HH could not check admin access. Open HH and try again.');
      }
    }

    function recheck() {
      if (!isCurrentSignIn()) {
        block('Open HH and use your current sign-in to continue.');
        return;
      }
      window.clearTimeout(scheduled);
      scheduled = window.setTimeout(() => void checkAccess(), 0);
    }

    const {data: {subscription}} = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        window.clearTimeout(scheduled);
        block('Sign in to HH to open the dashboard.');
        return;
      }
      if (approvedId && session?.user.id !== approvedId) block('Your HH sign-in has changed. Open HH to continue.');
      recheck();
    });
    const visibility = () => {if (!document.hidden) recheck();};
    const windowEvents = ['pageshow', 'storage', 'focus', 'online'] as const;
    for (const event of windowEvents) window.addEventListener(event, recheck);
    document.addEventListener('visibilitychange', visibility);
    recheck();

    return () => {
      active = false;
      window.clearTimeout(scheduled);
      subscription.unsubscribe();
      for (const event of windowEvents) window.removeEventListener(event, recheck);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  if (gate.status === 'checking') return <main className="auth-card"><p role="status">Checking admin access…</p></main>;
  if (gate.status === 'verify') return verify(gate.verification);
  if (gate.status === 'ready') return children(gate.access);
  return <main className="auth-card">
    <h1>Open HH to use Admin</h1>
    <p>{gate.message}</p>
    <a className="return-link" href={familyAppUrl.href}>Back to HH</a>
  </main>;
}
