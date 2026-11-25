import {StrictMode, Suspense, lazy, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createClient, type Session} from '@supabase/supabase-js';
import {Brand} from './Brand';
import './style.css';

const Dashboard = lazy(() => import('./Dashboard').then(module => ({default: module.Dashboard})));
const url = import.meta.env.VITE_SUPABASE_URL;
const publishable = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const link = new URLSearchParams(location.hash.slice(1));
const setup = ['invite', 'recovery'].includes(link.get('type') ?? '') && link.has('access_token');
const linkError = link.has('error') || new URLSearchParams(location.search).has('error');

const client = url && publishable?.startsWith('sb_publishable_')
  ? createClient(url, publishable, {auth: {persistSession: false, flowType: 'implicit'}})
  : null;

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!client);
  const [passwordSetup, setPasswordSetup] = useState(setup);
  const [role, setRole] = useState<{userId: string; value: string}>();
  const [message, setMessage] = useState(linkError ? 'This link has expired or is invalid. Request a new link.' : '');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [roleAttempt, setRoleAttempt] = useState(0);
  const userId = session?.user.id;

  useEffect(() => {
    if (!client) return;
    const {data} = client.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordSetup(true);
      setSession(next);
      if (!next && event === 'SIGNED_OUT') setRole(undefined);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!client || !userId) return;
    let current = true;
    client.from('user_profiles').select('role').eq('user_id', userId).maybeSingle().then(({data, error}) => {
      if (current) setRole({userId, value: error ? 'error' : data?.role ?? 'unapproved'});
    });
    return () => {current = false;};
  }, [userId, roleAttempt]);

  const currentRole = role?.userId === userId ? role?.value : undefined;
  async function authenticate(form: HTMLFormElement) {
    if (!client) return;
    const fields = new FormData(form);
    const email = String(fields.get('email') ?? '').trim();
    const password = String(fields.get('password') ?? '');
    setBusy(true);
    setMessage('');
    try {
      if (passwordSetup && session) {
        const {error} = await client.auth.updateUser({password});
        if (error) throw error;
        setPasswordSetup(false);
      } else if (recovery) {
        const {error} = await client.auth.resetPasswordForEmail(email, {redirectTo: location.origin + '/'});
        if (error) throw error;
        setMessage('If this address has an account, check your inbox for a password reset link.');
      } else {
        const {error} = await client.auth.signInWithPassword({email, password});
        if (error) throw error;
        setPasswordSetup(false);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication could not be completed.');
    } finally {setBusy(false);}
  }
  async function signOut() {
    await client?.auth.signOut({scope: 'local'});
    setSession(null);
    setRole(undefined);
    setPasswordSetup(false);
    setMessage('');
  }

  if (client && session && !passwordSetup && (currentRole === 'editor' || currentRole === 'viewer')) {
    return <Suspense fallback={<div className="auth-shell"><p role="status">Opening ESGHub…</p></div>}>
      <Dashboard key={session.user.id} client={client} editor={currentRole === 'editor'} signOut={signOut}/>
    </Suspense>;
  }
  return <div className="auth-shell">
    <div className="auth-card">
      <Brand/>
      {!ready ? <p role="status">Checking your session…</p> : !client ?
        <><h1>Connect ESGHub</h1><p>Configure the Supabase project URL and publishable key, then restart the app.</p></> :
        session && !passwordSetup ? <>
          <h1>HQ access</h1>
          <p role="status">{currentRole === 'error' ? 'Access could not be checked.' :
            currentRole === 'unapproved' ? 'Ask your ESGHub administrator to activate your account.' : 'Checking reporting permissions…'}</p>
          {currentRole === 'error' && <button onClick={() => {setRole(undefined); setRoleAttempt(n => n+1);}}>Try again</button>}
          <button onClick={signOut}>Sign out</button>
        </> : <>
          <h1>{session && passwordSetup ? 'Set your password' : recovery ? 'Reset your password' : 'Sign in to ESGHub'}</h1>
          <p className="muted">Private reporting workspace for invited HQ staff.</p>
          <form onSubmit={event => {event.preventDefault(); void authenticate(event.currentTarget);}}>
            {!session && <label>Work email<input name="email" type="email" autoComplete="email" required/></label>}
            {(!recovery || session) && <label>Password<input name="password" type="password"
              minLength={session ? 12 : undefined} autoComplete={session ? 'new-password' : 'current-password'} required/></label>}
            <button className="primary" disabled={busy}>{busy ? 'Please wait…' : session ? 'Save password' : recovery ? 'Send reset link' : 'Sign in'}</button>
          </form>
          {message && <p role="status">{message}</p>}
          {!session && <button className="link" onClick={() => {setRecovery(!recovery); setMessage('');}}>
            {recovery ? 'Back to sign in' : 'Forgot password?'}</button>}
        </>}
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);

