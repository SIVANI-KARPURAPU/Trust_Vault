
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import './App.css'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api/v1'

type User = {
  id: number
  name: string
  email: string
  role: string
}

type DocumentItem = {
  id: number
  title: string
  original_filename: string
  category: string
  size_bytes: number
  created_at: string
}

type AuthMode = 'login' | 'register'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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

  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [documentError, setDocumentError] = useState('')
  const [search, setSearch] = useState('')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadCategory, setUploadCategory] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dashboardMessage, setDashboardMessage] = useState('')
  const [dashboardError, setDashboardError] = useState('')

  const token = () => sessionStorage.getItem('trustvault_access_token')

  const apiRequest = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const accessToken = token()
      const headers = new Headers(options.headers)

      if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`)
      }

      if (
        options.body &&
        !(options.body instanceof FormData) &&
        !headers.has('Content-Type')
      ) {
        headers.set('Content-Type', 'application/json')
      }

      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers,
      })

      if (response.status === 401) {
        sessionStorage.removeItem('trustvault_access_token')
        setUser(null)
      }

      return response
    },
    [],
  )

  const loadDocuments = useCallback(async () => {
    setDocumentsLoading(true)
    setDocumentError('')

    try {
      const response = await apiRequest('/documents')
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setDocumentError(data.error || 'Could not load documents.')
        return
      }

      setDocuments(Array.isArray(data.documents) ? data.documents : [])
    } catch {
      setDocumentError('Cannot connect to the server. Check the backend.')
    } finally {
      setDocumentsLoading(false)
    }
  }, [apiRequest])

  useEffect(() => {
    if (user) {
      void loadDocuments()
    }
  }, [user, loadDocuments])

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
        setMessage('Account created. Please sign in with your credentials.')
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
      setDashboardMessage('')
      setDashboardError('')
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
    setDocuments([])
    setPassword('')
    setError('')
    setMessage('')
    setDashboardMessage('')
    setDashboardError('')
    setMode('login')
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDashboardMessage('')
    setDashboardError('')

    if (!uploadFile) {
      setDashboardError('Please choose a file to upload.')
      return
    }

    const formData = new FormData()
    formData.append('file', uploadFile)
    formData.append('title', uploadTitle.trim())
    formData.append('category', uploadCategory.trim())

    setUploading(true)

    try {
      const response = await apiRequest('/documents', {
        method: 'POST',
        body: formData,
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setDashboardError(data.error || 'Upload failed.')
        return
      }

      setDashboardMessage('Document uploaded successfully.')
      setUploadTitle('')
      setUploadCategory('')
      setUploadFile(null)

      const fileInput = document.getElementById('upload-file') as HTMLInputElement | null
      if (fileInput) fileInput.value = ''

      await loadDocuments()
    } catch {
      setDashboardError('Could not connect to the server.')
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload(item: DocumentItem) {
    setDashboardMessage('')
    setDashboardError('')

    try {
      const response = await apiRequest(
        `/documents/${item.id}/download`,
      )

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setDashboardError(data.error || 'Download failed or access was denied.')
        return
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = item.original_filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setDashboardMessage(`Downloaded ${item.original_filename}`)
    } catch {
      setDashboardError('Could not connect to the server.')
    }
  }

  const filteredDocuments = documents.filter((item) => {
    const query = search.trim().toLowerCase()
    return (
      item.title.toLowerCase().includes(query) ||
      item.original_filename.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query)
    )
  })

  if (user) {
    const isOwner = user.role.toLowerCase() === 'owner'
    const isAdmin = user.role.toLowerCase() === 'admin'

    return (
      <main className="dashboard-app">
        <aside className="dashboard-sidebar">
          <a className="brand dashboard-brand" href="#" aria-label="TrustVault">
            <span className="brand-mark">
              <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
                <path
                  d="M20 4 33 9v10c0 8-5.5 13.5-13 17C12.5 32.5 7 27 7 19V9L20 4Z"
                  stroke="currentColor"
                  strokeWidth="2.5"
                />
                <path
                  d="m13.5 19.5 4.5 4.5 9-10"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="brand-word">Trust<span>Vault</span></span>
          </a>

          <div className="sidebar-label">WORKSPACE</div>
          <div className="sidebar-link active">
            <span>▤</span> Documents
          </div>
          <div className="sidebar-note">
            Your documents, shared securely and managed with control.
          </div>

          <div className="sidebar-bottom">
            <div className="sidebar-user">
              <div className="user-avatar">
                {(user.name || user.email || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="sidebar-user-info">
                <strong>{user.name}</strong>
                <span>{user.role}</span>
              </div>
            </div>
            <button className="sidebar-logout" onClick={handleLogout}>
              Sign out <span>↗</span>
            </button>
          </div>
        </aside>

        <section className="dashboard-main">
          <header className="dashboard-topbar">
            <div>
              <div className="dashboard-eyebrow">SECURE WORKSPACE</div>
              <h1>Documents</h1>
              <p>Manage and access your files in one secure place.</p>
            </div>
            <div className="secure-indicator">
              <span className="status-dot" /> Secure session
            </div>
          </header>

          <section className="dashboard-welcome">
            <div>
              <span className="welcome-kicker">YOUR WORKSPACE</span>
              <h2>Welcome, {user.name}</h2>
              <p>
                {isOwner
                  ? 'Upload documents and keep access under your control.'
                  : isAdmin
                    ? 'Review available documents in your workspace.'
                    : 'Open the documents shared with you and download permitted files.'}
              </p>
            </div>
            <div className="role-chip">Role: {user.role}</div>
          </section>

          <section className="dashboard-stats">
            <article className="dashboard-stat">
              <span className="stat-icon">▤</span>
              <span className="stat-label">Available documents</span>
              <strong>{documents.length}</strong>
              <small>Documents visible to your account</small>
            </article>
            <article className="dashboard-stat">
              <span className="stat-icon gold-stat-icon">⌕</span>
              <span className="stat-label">Search results</span>
              <strong>{filteredDocuments.length}</strong>
              <small>Matching your current search</small>
            </article>
            <article className="dashboard-stat">
              <span className="stat-icon green-stat-icon">✓</span>
              <span className="stat-label">Session status</span>
              <strong className="session-active">Active</strong>
              <small>Authenticated workspace</small>
            </article>
          </section>

          {dashboardMessage && (
            <div className="dashboard-alert dashboard-success" role="status">
              <span>✓</span> {dashboardMessage}
            </div>
          )}
          {dashboardError && (
            <div className="dashboard-alert dashboard-danger" role="alert">
              {dashboardError}
            </div>
          )}

          {isOwner && (
            <section className="dashboard-panel">
              <div className="panel-heading">
                <div>
                  <h2>Upload a document</h2>
                  <p>Add a file to your secure workspace.</p>
                </div>
                <span className="panel-tag">OWNER</span>
              </div>

              <form className="upload-form" onSubmit={handleUpload}>
                <div className="upload-fields">
                  <div className="form-field">
                    <label htmlFor="upload-title">Document title</label>
                    <input
                      id="upload-title"
                      value={uploadTitle}
                      onChange={(event) => setUploadTitle(event.target.value)}
                      placeholder="e.g. Project agreement"
                      maxLength={255}
                      required
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="upload-category">Category</label>
                    <input
                      id="upload-category"
                      value={uploadCategory}
                      onChange={(event) => setUploadCategory(event.target.value)}
                      placeholder="e.g. Work, Personal"
                      maxLength={100}
                      required
                    />
                  </div>
                  <div className="form-field upload-file-field">
                    <label htmlFor="upload-file">Choose file</label>
                    <input
                      id="upload-file"
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.txt"
                      onChange={(event) =>
                        setUploadFile(event.target.files?.[0] || null)
                      }
                      required
                    />
                    <small>PDF, PNG, JPG, JPEG or TXT</small>
                  </div>
                </div>
                <button className="primary-button upload-button" type="submit" disabled={uploading}>
                  {uploading ? 'Uploading…' : 'Upload securely'} <span>→</span>
                </button>
              </form>
            </section>
          )}

          <section className="dashboard-panel documents-panel">
            <div className="panel-heading documents-heading">
              <div>
                <h2>Your documents</h2>
                <p>Only files permitted for your account can be downloaded.</p>
              </div>
              <button
                className="refresh-button"
                onClick={() => void loadDocuments()}
                disabled={documentsLoading}
              >
                ↻ Refresh
              </button>
            </div>

            <div className="document-search">
              <span>⌕</span>
              <input
                aria-label="Search documents"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by title, filename or category..."
              />
            </div>

            {documentsLoading ? (
              <div className="dashboard-empty">
                <div className="empty-symbol">↻</div>
                <h3>Loading documents</h3>
                <p>Please wait while we load your workspace.</p>
              </div>
            ) : documentError ? (
              <div className="dashboard-empty">
                <h3>Documents could not be loaded</h3>
                <p>{documentError}</p>
                <button className="secondary-button" onClick={() => void loadDocuments()}>
                  Try again
                </button>
              </div>
            ) : filteredDocuments.length === 0 ? (
              <div className="dashboard-empty">
                <div className="empty-symbol">▤</div>
                <h3>{search ? 'No matching documents' : 'No documents yet'}</h3>
                <p>
                  {search
                    ? 'Try a different search term.'
                    : isOwner
                      ? 'Upload your first document using the form above.'
                      : 'Documents shared with your account will appear here.'}
                </p>
              </div>
            ) : (
              <div className="document-list">
                {filteredDocuments.map((item) => (
                  <article className="document-row" key={item.id}>
                    <div className="document-file-icon">PDF</div>
                    <div className="document-details">
                      <strong>{item.title}</strong>
                      <span>{item.original_filename}</span>
                      <div className="document-meta">
                        <span>{item.category}</span>
                        <span>{formatBytes(item.size_bytes)}</span>
                        <span>
                          {new Date(item.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <button
                      className="download-button"
                      onClick={() => void handleDownload(item)}
                    >
                      Download <span>↓</span>
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <footer className="dashboard-footer">
            <span>© 2026 TrustVault</span>
            <span>Secure sharing. Clear control.</span>
          </footer>
        </section>
      </main>
    )
  }

  return (
    <main className="tv-app">
      <header className="topbar">
        <a className="brand" href="#" aria-label="TrustVault home">
          <span className="brand-mark">
            <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <path
                d="M20 4 33 9v10c0 8-5.5 13.5-13 17C12.5 32.5 7 27 7 19V9L20 4Z"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <path
                d="m13.5 19.5 4.5 4.5 9-10"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
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
            <span className="float-icon">▤</span>
          </div>
          <div className="floating-card floating-shield" aria-hidden="true">
            <span>◇</span>
          </div>
          <div className="floating-card floating-lock" aria-hidden="true">
            <span>⌑</span>
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
          <div className="auth-card">
            <div className="auth-symbol">
              <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <rect x="7" y="13" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="2" />
                <path d="M11 13V9a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
