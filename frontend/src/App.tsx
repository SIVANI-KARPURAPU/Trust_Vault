
import { useState, type FormEvent } from 'react'
import './App.css'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api/v1'

type User = {
  id: number
  name: string
  email: string
  role: string
}

type AuthMode = 'login' | 'register'

function App() {
  const [mode, setMode] = useState<AuthMode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [user, setUser] = useState<User | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register'
      const payload =
        mode === 'login'
          ? { email, password }
          : { name: name.trim(), email, password }

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(data.error || 'Request failed. Please try again.')
        return
      }

      if (mode === 'register') {
        setMessage('Account created! Please sign in with your new credentials.')
        setMode('login')
        setPassword('')
        setName('')
        return
      }

      if (!data.access_token || !data.user) {
        setError('Unexpected response from the server.')
        return
      }

      sessionStorage.setItem('trustvault_access_token', data.access_token)
      setUser(data.user as User)
      setPassword('')
    } catch {
      setError('Cannot connect to TrustVault. Check that the backend is running.')
    } finally {
      setLoading(false)
    }
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode)
    setError('')
    setMessage('')
    setPassword('')
    setShowPassword(false)
  }

  function handleLogout() {
    sessionStorage.removeItem('trustvault_access_token')
    setUser(null)
    setPassword('')
    setError('')
    setMessage('')
    setMode('login')
  }

  return (
    <main className="tv-app">
      <div className="ambient-glow ambient-glow-one" />
      <div className="ambient-glow ambient-glow-two" />

      <header className="topbar">
        <a className="brand" href="#" aria-label="TrustVault home">
          <span className="brand-mark">
            <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <path d="M20 4 33 9v10c0 8-5.5 13.5-13 17C12.5 32.5 7 27 7 19V9L20 4Z"
                stroke="currentColor" strokeWidth="2.5" />
              <path d="m13.5 19.5 4.5 4.5 9-10"
                stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-word">Trust<span>Vault</span></span>
        </a>
        <span className="topbar-status">
          <span className="status-dot" /> SECURE WORKSPACE
        </span>
      </header>

      <section className="auth-layout">
        <section className="hero-panel">
          <div className="hero-grid" />

          <div className="floating-card floating-document" aria-hidden="true">
            <span className="float-icon">📄</span>
            <span className="float-lines"><i /><i /><i /></span>
          </div>
          <div className="floating-card floating-shield" aria-hidden="true">
            <span>🛡️</span>
          </div>
          <div className="floating-card floating-lock" aria-hidden="true">
            <span>🔐</span>
          </div>
          <div className="floating-orb orb-one" />
          <div className="floating-orb orb-two" />

          <div className="hero-content">
            <div className="hero-pill">
              <span className="status-dot" /> PRIVATE BY DESIGN
            </div>
            <h1>Your files.<br /><span>Your rules.</span></h1>
            <p className="hero-description">
              A smarter way to protect, share, and track your important documents.
              You stay in control at every step.
            </p>

            <div className="hero-features">
              <div className="hero-feature">
                <span className="feature-icon">✓</span>
                <span><strong>Share with confidence</strong><small>Control who can access your files</small></span>
              </div>
              <div className="hero-feature">
                <span className="feature-icon">✓</span>
                <span><strong>Stay in control</strong><small>Manage and revoke permissions</small></span>
              </div>
              <div className="hero-feature">
                <span className="feature-icon">✓</span>
                <span><strong>Know what happened</strong><small>Keep a record of important actions</small></span>
              </div>
            </div>
          </div>

          <div className="hero-footer">
            <span>TRUST, BUILT INTO EVERY SHARE.</span>
            <span className="footer-orbit">✳</span>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-card" key={user ? 'signed-in' : mode}>
            {user ? (
              <div className="signed-in-view">
                <div className="auth-symbol success-symbol">✓</div>
                <span className="section-kicker">AUTHENTICATION COMPLETE</span>
                <h2>Welcome back,<br />{user.name}</h2>
                <p className="auth-subtitle">
                  Signed in as {user.email}
                </p>
                <div className="role-chip">Account role: {user.role}</div>
                <p className="inline-note">
                  Your secure session is active. Your document dashboard is the next step.
                </p>
                <button className="primary-button" onClick={handleLogout}>
                  Sign out <span>→</span>
                </button>
              </div>
            ) : (
              <>
                <div className="auth-symbol">
                  <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                    <rect x="7" y="13" width="18" height="14" rx="3"
                      stroke="currentColor" strokeWidth="2" />
                    <path d="M11 13V9a5 5 0 0 1 10 0v4"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <circle cx="16" cy="20" r="1.5" fill="currentColor" />
                  </svg>
                </div>

                <span className="section-kicker">
                  {mode === 'login' ? 'WELCOME BACK' : 'YOUR SECURE SPACE STARTS HERE'}
                </span>
                <h2>{mode === 'login' ? 'Good to see you.' : 'Create your account.'}</h2>
                <p className="auth-subtitle">
                  {mode === 'login'
                    ? 'Sign in to continue to your secure workspace.'
                    : 'Set up your account to start sharing with confidence.'}
                </p>

                <div className="auth-tabs">
                  <button
                    type="button"
                    className={mode === 'login' ? 'auth-tab active' : 'auth-tab'}
                    onClick={() => switchMode('login')}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    className={mode === 'register' ? 'auth-tab active' : 'auth-tab'}
                    onClick={() => switchMode('register')}
                  >
                    Create account
                  </button>
                </div>

                <form className="auth-form" onSubmit={handleSubmit}>
                  {mode === 'register' && (
                    <div className="form-field">
                      <label htmlFor="name">Full name</label>
                      <input
                        id="name"
                        type="text"
                        placeholder="Enter your full name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        autoComplete="name"
                        maxLength={120}
                        required
                      />
                    </div>
                  )}

                  <div className="form-field">
                    <label htmlFor="email">Email address</label>
                    <input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      maxLength={255}
                      required
                    />
                  </div>

                  <div className="form-field">
                    <div className="label-row">
                      <label htmlFor="password">Password</label>
                      {mode === 'register' && <span>12+ characters</span>}
                    </div>
                    <div className="password-wrap">
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder={mode === 'login' ? 'Enter your password' : 'Create a strong password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        minLength={mode === 'register' ? 12 : undefined}
                        required
                      />
                      <button
                        className="password-toggle"
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>

                  {error && <p className="form-message error-message" role="alert">{error}</p>}
                  {message && <p className="form-message success-message" role="status">{message}</p>}

                  <button className="primary-button" type="submit" disabled={loading}>
                    {loading
                      ? 'Please wait…'
                      : mode === 'login'
                        ? 'Sign in securely'
                        : 'Create secure account'}
                    {!loading && <span>→</span>}
                  </button>
                </form>

                <p className="security-caption">
                  <span>◆</span> Your privacy matters. Your access stays controlled.
                </p>
              </>
            )}
          </div>

          <footer className="auth-footer">
            <span>© 2026 TrustVault</span>
            <span>Built for secure sharing</span>
          </footer>
        </section>
      </section>
    </main>
  )
}

export default App
