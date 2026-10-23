
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
type AdminUser = { id: number; name: string; email: string; role: string; is_active?: boolean }
type AuditLog = { id: number; actor_id?: number | null; action: string; resource_type: string; resource_id?: string | number | null; outcome: string; ip_address?: string | null; details?: Record<string, unknown> | string | null; created_at: string }
type DashboardTab = 'documents' | 'users' | 'audit'

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
  const [activeTab, setActiveTab] = useState<DashboardTab>('documents')
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [adminUsersLoading, setAdminUsersLoading] = useState(false)
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditVerification, setAuditVerification] = useState<Record<string, unknown> | null>(null)
  const [grantDocumentId, setGrantDocumentId] = useState('')
  const [grantEmail, setGrantEmail] = useState('')
  const [grantLevel, setGrantLevel] = useState<'read' | 'edit'>('read')
  const [revokeDocumentId, setRevokeDocumentId] = useState('')
  const [revokeUserId, setRevokeUserId] = useState('')
  const [editingDocumentId, setEditingDocumentId] = useState<number | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingCategory, setEditingCategory] = useState('')

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

  async function loadAdminUsers() {
    setAdminUsersLoading(true)
    setDashboardError('')
    try {
      const response = await apiRequest('/admin/users')
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { setDashboardError(data.error || 'Could not load users.'); return }
      setAdminUsers(Array.isArray(data.users) ? data.users : [])
    } catch { setDashboardError('Could not connect while loading users.') }
    finally { setAdminUsersLoading(false) }
  }

  async function loadAuditLogs() {
    setAuditLoading(true)
    setDashboardError('')
    try {
      const response = await apiRequest('/admin/audit-logs?page=1&per_page=50')
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { setDashboardError(data.error || 'Could not load audit logs.'); return }
      setAuditLogs(Array.isArray(data.logs) ? data.logs : [])
    } catch { setDashboardError('Could not connect while loading audit logs.') }
    finally { setAuditLoading(false) }
  }

  async function verifyAuditChain() {
    setDashboardMessage('')
    setDashboardError('')
    setAuditVerification(null)
    try {
      const response = await apiRequest('/admin/audit-logs/verify')
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { setDashboardError(data.error || 'Audit verification failed.'); return }
      setAuditVerification(data)
      setDashboardMessage(data.valid ? 'Audit chain verification passed.' : 'WARNING: audit chain verification failed.')
    } catch { setDashboardError('Could not connect while verifying the audit chain.') }
  }

  async function promoteUser(target: AdminUser) {
    if (!window.confirm(`Promote ${target.email} to owner?`)) return
    setDashboardMessage('')
    setDashboardError('')
    try {
      const response = await apiRequest(`/admin/users/${target.id}/role`, { method: 'PATCH', body: JSON.stringify({ role: 'owner' }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { setDashboardError(data.error || 'Could not update role.'); return }
      setDashboardMessage(`${target.email} promoted to owner.`)
      await loadAdminUsers()
    } catch { setDashboardError('Could not connect while updating role.') }
  }

  function beginEdit(item: DocumentItem) {
    setEditingDocumentId(item.id)
    setEditingTitle(item.title)
    setEditingCategory(item.category)
    setDashboardError('')
    setDashboardMessage('')
  }

  async function saveDocumentEdit(item: DocumentItem) {
    if (!editingTitle.trim() || !editingCategory.trim()) { setDashboardError('Title and category are required.'); return }
    try {
      const response = await apiRequest(`/documents/${item.id}`, { method: 'PATCH', body: JSON.stringify({ title: editingTitle.trim(), category: editingCategory.trim() }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { setDashboardError(data.error || 'Could not update document.'); return }
      setDashboardMessage('Document details updated.')
      setEditingDocumentId(null)
      await loadDocuments()
    } catch { setDashboardError('Could not connect while updating document.') }
  }

  async function deleteDocument(item: DocumentItem) {
    if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return
    try {
      const response = await apiRequest(`/documents/${item.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { setDashboardError(data.error || 'Could not delete document.'); return }
      setDashboardMessage('Document deleted.')
      await loadDocuments()
    } catch { setDashboardError('Could not connect while deleting document.') }
  }

  async function grantPermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const documentId = Number(grantDocumentId)
    if (!Number.isInteger(documentId) || documentId < 1 || !grantEmail.trim()) { setDashboardError('Enter a valid document ID and email.'); return }
    try {
      const response = await apiRequest(`/documents/${documentId}/permissions`, { method: 'POST', body: JSON.stringify({ email: grantEmail.trim(), access_level: grantLevel }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { setDashboardError(data.error || 'Could not grant permission.'); return }
      setDashboardMessage(`Granted ${grantLevel} access to ${grantEmail.trim()}.`)
      setGrantEmail('')
    } catch { setDashboardError('Could not connect while granting permission.') }
  }

  async function revokePermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const documentId = Number(revokeDocumentId)
    const targetUserId = Number(revokeUserId)
    if (!Number.isInteger(documentId) || documentId < 1 || !Number.isInteger(targetUserId) || targetUserId < 1) { setDashboardError('Enter valid document and user IDs.'); return }
    if (!window.confirm(`Revoke access for user ${targetUserId} to document ${documentId}?`)) return
    try {
      const response = await apiRequest(`/documents/${documentId}/permissions/${targetUserId}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { setDashboardError(data.error || 'Could not revoke permission.'); return }
      setDashboardMessage('Permission revoked. The change applies immediately.')
      setRevokeUserId('')
    } catch { setDashboardError('Could not connect while revoking permission.') }
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
          <button type="button" className={`sidebar-link ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => setActiveTab('documents')}>
            <span>▤</span> Documents
          </button>
          {isAdmin && <>
            <button type="button" className={`sidebar-link ${activeTab === 'users' ? 'active' : ''}`} onClick={() => { setActiveTab('users'); void loadAdminUsers() }}>
              <span>♙</span> User management
            </button>
            <button type="button" className={`sidebar-link ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => { setActiveTab('audit'); void loadAuditLogs() }}>
              <span>◷</span> Audit trail
            </button>
          </>}
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

          {isAdmin && activeTab === 'users' && (
            <section className="dashboard-panel management-panel">
              <div className="panel-heading"><div><h2>User management</h2><p>Review registered accounts. Admin-only actions are checked by the server.</p></div><button className="refresh-button" onClick={() => void loadAdminUsers()} disabled={adminUsersLoading}>↻ Refresh</button></div>
              {adminUsersLoading ? <p className="admin-hint">Loading users…</p> : adminUsers.length === 0 ? <p className="admin-hint">No users returned.</p> : <div className="table-scroll"><table className="admin-table"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Action</th></tr></thead><tbody>{adminUsers.map((person) => <tr key={person.id}><td>{person.name || '—'}</td><td>{person.email}</td><td><span className="role-chip">{person.role}</span></td><td>{person.role.toLowerCase() === 'viewer' ? <button className="small-action" onClick={() => void promoteUser(person)}>Promote to owner</button> : <span className="admin-hint">No action</span>}</td></tr>)}</tbody></table></div>}
            </section>
          )}

          {isAdmin && activeTab === 'audit' && (
            <section className="dashboard-panel management-panel">
              <div className="panel-heading"><div><h2>Audit trail</h2><p>Recent security-relevant events and hash-chain integrity.</p></div><div className="panel-actions"><button className="refresh-button" onClick={() => void loadAuditLogs()} disabled={auditLoading}>↻ Refresh</button><button className="small-action" onClick={() => void verifyAuditChain()}>Verify chain</button></div></div>
              {auditVerification && <div className={`verification-result ${auditVerification.valid ? 'verification-ok' : 'verification-fail'}`} role="status"><strong>{auditVerification.valid ? 'Chain valid' : 'Chain verification failed'}</strong><span>{String(auditVerification.entries_checked ?? 0)} entries checked</span>{auditVerification.last_hash ? <code>{String(auditVerification.last_hash)}</code> : null}</div>}
              {auditLoading ? <p className="admin-hint">Loading audit events…</p> : auditLogs.length === 0 ? <p className="admin-hint">No audit events returned.</p> : <div className="table-scroll"><table className="admin-table"><thead><tr><th>Time</th><th>Action</th><th>Resource</th><th>Outcome</th><th>Actor</th><th>Details</th></tr></thead><tbody>{auditLogs.map((log) => <tr key={log.id}><td>{new Date(log.created_at).toLocaleString()}</td><td>{log.action}</td><td>{log.resource_type}{log.resource_id ? ` #${log.resource_id}` : ''}</td><td><span className={`outcome-chip ${log.outcome.toLowerCase() === 'success' || log.outcome.toLowerCase() === 'allowed' ? 'outcome-good' : 'outcome-other'}`}>{log.outcome}</span></td><td>{log.actor_id ?? 'System/unknown'}</td><td className="audit-details">{typeof log.details === 'string' ? log.details : JSON.stringify(log.details ?? {})}</td></tr>)}</tbody></table></div>}
            </section>
          )}

          {activeTab === 'documents' && isOwner && (
            <section className="dashboard-panel management-panel">
              <div className="panel-heading"><div><h2>Document permissions</h2><p>Grant named users read/edit access or revoke an existing grant.</p></div><span className="panel-tag">OWNER</span></div>
              <form className="permission-form" onSubmit={grantPermission}><h3>Grant access</h3><div className="permission-fields"><label>Document ID<input type="number" min="1" value={grantDocumentId} onChange={(event) => setGrantDocumentId(event.target.value)} placeholder="e.g. 12" required /></label><label>User email<input type="email" value={grantEmail} onChange={(event) => setGrantEmail(event.target.value)} placeholder="person@example.com" required /></label><label>Access level<select value={grantLevel} onChange={(event) => setGrantLevel(event.target.value as 'read' | 'edit')}><option value="read">Read only</option><option value="edit">Read and edit</option></select></label><button className="small-action" type="submit">Grant access</button></div></form>
              <form className="permission-form revoke-form" onSubmit={revokePermission}><h3>Revoke access</h3><p className="admin-hint">Enter the document ID and the target user's numeric ID. Revocation is enforced by the backend.</p><div className="permission-fields"><label>Document ID<input type="number" min="1" value={revokeDocumentId} onChange={(event) => setRevokeDocumentId(event.target.value)} placeholder="e.g. 12" required /></label><label>Target user ID<input type="number" min="1" value={revokeUserId} onChange={(event) => setRevokeUserId(event.target.value)} placeholder="e.g. 4" required /></label><button className="danger-action" type="submit">Revoke access</button></div></form>
            </section>
          )}

          {activeTab === 'documents' && isOwner && (
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

          {activeTab === 'documents' && <section className="dashboard-panel documents-panel">
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
                      {editingDocumentId === item.id ? <div className="inline-edit-fields"><input aria-label="Document title" value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} maxLength={255} /><input aria-label="Document category" value={editingCategory} onChange={(event) => setEditingCategory(event.target.value)} maxLength={100} /></div> : <><strong>{item.title}</strong><span>{item.original_filename}</span><div className="document-meta"><span>{item.category}</span><span>{formatBytes(item.size_bytes)}</span><span>{new Date(item.created_at).toLocaleDateString()}</span></div></>}
                    </div>
                    <div className="document-actions">
                      <button className="download-button" onClick={() => void handleDownload(item)}>Download <span>↓</span></button>
                      {isOwner && (editingDocumentId === item.id ? <><button className="small-action" onClick={() => void saveDocumentEdit(item)}>Save</button><button className="refresh-button" onClick={() => setEditingDocumentId(null)}>Cancel</button> </> : <><button className="small-action" onClick={() => beginEdit(item)}>Edit</button><button className="danger-action" onClick={() => void deleteDocument(item)}>Delete</button></>)}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>}

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
