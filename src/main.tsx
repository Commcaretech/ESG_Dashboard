import {StrictMode, Suspense, lazy, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Brand} from './Brand';
import {client, type ReportingClient} from './neon';
import './style.css';

const Dashboard = lazy(() => import('./Dashboard').then(module => ({default: module.Dashboard})));
const url = new URL(location.href);
const resetToken = url.searchParams.get('token');
const invalidLink = url.searchParams.has('error');
if (resetToken || invalidLink) history.replaceState(history.state, '', url.pathname);

function App({client}: {client: ReportingClient}) {
  const {data: session, isPending, error: sessionError, refetch} = client.auth.useSession();
  const [reset, setReset] = useState(resetToken);
  const [role, setRole] = useState<{userId: string; value: string}>();
  const [message, setMessage] = useState(invalidLink ? 'This link is invalid or has expired. Request a new password reset link.' : '');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [roleAttempt, setRoleAttempt] = useState(0);
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    let current = true;
    client.from('user_profiles').select('role').eq('user_id', userId).maybeSingle().then(({data, error}) => {
      if (current) setRole({userId, value: error ? 'error' : data?.role ?? 'unapproved'});
    }, () => {if (current) setRole({userId, value: 'error'});});
    return () => {current = false;};
  }, [client, userId, roleAttempt]);

  const currentRole = role?.userId === userId ? role?.value : undefined;
  async function authenticate(form: HTMLFormElement) {
    const fields = new FormData(form);
    const email = String(fields.get('email') ?? '').trim();
    const password = String(fields.get('password') ?? '');
    setBusy(true);
    setMessage('');
    try {
      if (reset) {
        const {error} = await client.auth.resetPassword({token: reset, newPassword: password});
        if (error) throw error;
        setReset(null);
        setRecovery(false);
        setMessage('Password updated. Sign in with your new password.');
      } else if (recovery) {
        const {error} = await client.auth.requestPasswordReset({email, redirectTo: location.origin + '/'});
        if (error) throw error;
        setMessage('If this address has an account, check your inbox for a password reset link.');
      } else {
        const {error} = await client.auth.signIn.email({email, password, rememberMe: false});
        if (error) throw error;
      }
    } catch (error) {
      const detail = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
      setMessage(detail || 'Authentication could not be completed.');
    } finally {setBusy(false);}
  }

  async function signOut() {
    setBusy(true);
    try {
      const {error} = await client.auth.signOut();
      if (error) throw error;
      setRole(undefined);
      setMessage('');
    } catch {
      setMessage('Sign-out failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (session && !reset && (currentRole === 'editor' || currentRole === 'viewer')) {
    return <Suspense fallback={<div className="auth-shell"><p role="status">Opening ESGHub…</p></div>}>
      {message && <p className="notice" role="alert">{message}</p>}
      <Dashboard key={session.user.id} client={client} editor={currentRole === 'editor'} signOut={signOut}/>
    </Suspense>;
  }
  return <div className="auth-shell">
    <div className="auth-card">
      <Brand/>
      {isPending && !reset ? <p role="status">Checking your session…</p> :
        sessionError && !reset ? <><h1>HQ access</h1><p role="alert">Could not check your sign-in.</p><button onClick={() => {void refetch();}}>Try again</button></> :
        session && !reset ? <>
          <h1>HQ access</h1>
          <p role="status">{currentRole === 'error' ? 'Access could not be checked.' :
            currentRole === 'unapproved' ? 'Ask your ESGHub administrator to activate your account.' : 'Checking reporting permissions…'}</p>
          {currentRole === 'error' && <button onClick={() => {setRole(undefined); setRoleAttempt(n => n+1);}}>Try again</button>}
          <button disabled={busy} onClick={signOut}>Sign out</button>
        </> : <>
          <h1>{reset ? 'Set a new password' : recovery ? 'Reset your password' : 'Sign in to ESGHub'}</h1>
          <p className="muted">Private reporting workspace for approved HQ staff.</p>
          <form onSubmit={event => {event.preventDefault(); void authenticate(event.currentTarget);}}>
            {!reset && <label>Work email<input name="email" type="email" autoComplete="email" required/></label>}
            {(!recovery || reset) && <label>Password<input name="password" type="password"
              minLength={reset ? 12 : undefined} maxLength={128} autoComplete={reset ? 'new-password' : 'current-password'} required/></label>}
            <button className="primary" disabled={busy}>{busy ? 'Please wait…' : reset ? 'Save password' : recovery ? 'Send reset link' : 'Sign in'}</button>
          </form>
          {!reset && <button className="link" disabled={busy} onClick={() => {setRecovery(!recovery); setMessage('');}}>
            {recovery ? 'Back to sign in' : 'Forgot password?'}</button>}
        </>}
      {message && <p role="status">{message}</p>}
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode>{client ? <App client={client}/> :
  <div className="auth-shell"><div className="auth-card"><Brand/><h1>Connect ESGHub</h1>
    <p>Configure the Neon Auth and Data API HTTPS URLs, then restart the app.</p></div></div>
}</StrictMode>);
