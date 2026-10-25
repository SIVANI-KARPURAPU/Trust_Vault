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
  owner_id?: number
  owner_name?: string | null
  owner_email?: string | null
}

type AuthMode = 'login' | 'register'

type AdminUser = {
  id: number
  name: string
  email: string
  role: string
  is_active?: boolean
}

type AuditLog = {
  id: number
  actor_id?: number | null
  actor_name?: string | null
  actor_email?: string | null
  action: string
  resource_type: string
  resource_id?: string | number | null
  outcome: string
  ip_address?: string | null
  details?: Record<string, unknown> | string | null
  created_at: string
}

type AuditStats = {
  total_events: number
  successful_events: number
  failed_events: number
  login_events: number
}

type DashboardTab =
  | 'ownerDashboard'
  | 'overview'
  | 'documents'
  | 'upload'
  | 'access'
  | 'activity'
  | 'profile'
  | 'settings'
  | 'users'
  | 'audit'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}


function parseAuditTimestamp(value: string): Date {
  // API timestamps without an explicit timezone are stored as UTC by this project.
  // Append Z only when the API omitted its timezone marker; don't shift already-zoned values.
  const raw = String(value ?? '').trim()
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
  return new Date(hasTimezone ? raw : `${raw}Z`)
}

function formatAuditDate(value: string): string {
  const date = parseAuditTimestamp(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function formatAuditTime(value: string): string {
  const date = parseAuditTimestamp(value)
  if (Number.isNaN(date.getTime())) return 'Invalid time'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date)
}

function formatAuditDateTime(value: string): string {
  const date = parseAuditTimestamp(value)
  if (Number.isNaN(date.getTime())) return 'Invalid timestamp'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date)
}

function auditDateBoundary(date: string, endOfDay = false): number {
  // Filter dates are calendar dates in India (IST, UTC+05:30).
  return new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00'}+05:30`).getTime()
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
  const [documentCategoryFilter, setDocumentCategoryFilter] = useState('all')
  const [documentSort, setDocumentSort] = useState<'name-asc' | 'name-desc'>('name-asc')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadCategory, setUploadCategory] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dashboardMessage, setDashboardMessage] = useState('')
  const [dashboardError, setDashboardError] = useState('')
  const [activeTab, setActiveTab] = useState<DashboardTab>('ownerDashboard')
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [securityAlerts, setSecurityAlerts] = useState(true)
  const [compactView, setCompactView] = useState(false)

  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [adminUsersLoading, setAdminUsersLoading] = useState(false)

  // Admin user search, role filter and sorting
  const [adminUserSearch, setAdminUserSearch] = useState('')
  const [adminUserRoleFilter, setAdminUserRoleFilter] = useState<
    'all' | 'admin' | 'owner' | 'viewer'
  >('all')
  const [adminUserSort, setAdminUserSort] = useState<
    'name' | 'email' | 'role'
  >('name')

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [auditSection, setAuditSection] = useState<'login' | 'document'>('login')
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditKeywordDraft, setAuditKeywordDraft] = useState('')
  const [auditFromDraft, setAuditFromDraft] = useState('')
  const [auditToDraft, setAuditToDraft] = useState('')
  const [auditTypeDraft, setAuditTypeDraft] = useState<
    'all' | 'login' | 'document' | 'permission' | 'user' | 'other'
  >('all')
  const [auditOutcomeDraft, setAuditOutcomeDraft] = useState<
    'all' | 'success' | 'failure'
  >('all')
  const [auditSort, setAuditSort] = useState<'newest' | 'oldest'>('newest')
  const [auditFilters, setAuditFilters] = useState({
    keyword: '',
    from: '',
    to: '',
    type: 'all' as 'all' | 'login' | 'document' | 'permission' | 'user' | 'other',
    outcome: 'all' as 'all' | 'success' | 'failure',
  })
  const [auditStats, setAuditStats] = useState<AuditStats>({
    total_events: 0,
    successful_events: 0,
    failed_events: 0,
    login_events: 0,
  })
  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLog | null>(null)
  const [auditVerification, setAuditVerification] =
    useState<Record<string, unknown> | null>(null)

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

      const role = String(data.user.role).toLowerCase()
      setActiveTab(
        role === 'admin'
          ? 'overview'
          : role === 'owner'
            ? 'ownerDashboard'
            : 'documents',
      )

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

      const fileInput = document.getElementById(
        'upload-file',
      ) as HTMLInputElement | null

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

      if (!response.ok) {
        setDashboardError(data.error || 'Could not load users.')
        return
      }

      setAdminUsers(Array.isArray(data.users) ? data.users : [])
    } catch {
      setDashboardError('Could not connect while loading users.')
    } finally {
      setAdminUsersLoading(false)
    }
  }

  async function loadAuditLogs() {
    setAuditLoading(true)
    setDashboardError('')

    try {
      const allLogs: AuditLog[] = []
      const perPage = 100
      let page = 1

      while (true) {
        const response = await apiRequest(
          `/admin/audit-logs?page=${page}&per_page=${perPage}`,
        )
        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
          setDashboardError(data.error || 'Could not load audit logs.')
          return
        }

        const pageLogs = Array.isArray(data.logs)
          ? (data.logs as AuditLog[])
          : []
        allLogs.push(...pageLogs)

        if (pageLogs.length < perPage) break
        page += 1

        if (page > 10000) {
          throw new Error('Audit log pagination exceeded the safety limit.')
        }
      }

      setAuditLogs(allLogs)
      setSelectedAuditLog(current =>
        current && allLogs.some(log => log.id === current.id)
          ? allLogs.find(log => log.id === current.id) ?? null
          : allLogs[0] ?? null,
      )

      // Statistics come from the backend and are based on the real audit table.
      const statsResponse = await apiRequest('/admin/audit-logs/stats')
      const statsData = await statsResponse.json().catch(() => ({}))
      if (statsResponse.ok) {
        setAuditStats({
          total_events: Number(statsData.total_events ?? allLogs.length),
          successful_events: Number(statsData.successful_events ?? 0),
          failed_events: Number(statsData.failed_events ?? 0),
          login_events: Number(statsData.login_events ?? 0),
        })
      } else {
        setAuditStats({
          total_events: allLogs.length,
          successful_events: allLogs.filter(log => ['success', 'allowed'].includes(log.outcome.toLowerCase())).length,
          failed_events: allLogs.filter(log => !['success', 'allowed'].includes(log.outcome.toLowerCase())).length,
          login_events: allLogs.filter(log => /login|auth/i.test(log.action)).length,
        })
      }
    } catch {
      setDashboardError('Could not connect while loading all audit events.')
    } finally {
      setAuditLoading(false)
    }
  }

  function exportAuditCsv() {
    const columns = ['id', 'created_at', 'action', 'resource_type', 'resource_id', 'outcome', 'actor_id', 'actor_name', 'actor_email', 'ip_address', 'details']
    const csvCell = (value: unknown) => {
      let text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
      return `"${text.replace(/"/g, '""')}"`
    }
    const rows = filteredAuditLogs.map(log => [
      log.id, log.created_at, log.action, log.resource_type, log.resource_id,
      log.outcome, log.actor_id, log.actor_name, log.actor_email, log.ip_address,
      typeof log.details === 'string' ? log.details : JSON.stringify(log.details ?? {}),
    ])
    const csv = [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `trustvault-audit-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  async function verifyAuditChain() {
    setDashboardMessage('')
    setDashboardError('')
    setAuditVerification(null)

    try {
      const response = await apiRequest('/admin/audit-logs/verify')
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setDashboardError(data.error || 'Audit verification failed.')
        return
      }

      setAuditVerification(data)
      setDashboardMessage(
        data.valid
          ? 'Audit chain verification passed.'
          : 'WARNING: audit chain verification failed.',
      )
    } catch {
      setDashboardError('Could not connect while verifying the audit chain.')
    }
  }

  async function changeUserRole(
    target: AdminUser,
    nextRole: 'owner' | 'viewer',
  ) {
    const action =
      nextRole === 'owner' ? 'promote to owner' : 'change to viewer'

    if (
      !window.confirm(
        `Are you sure you want to ${action}: ${target.email}?`,
      )
    ) {
      return
    }

    setDashboardMessage('')
    setDashboardError('')

    try {
      const response = await apiRequest(
        `/admin/users/${target.id}/role`,
        {
          method: 'PATCH',
          body: JSON.stringify({ role: nextRole }),
        },
      )

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setDashboardError(data.error || 'Could not update role.')
        return
      }

      setDashboardMessage(
        `${target.email} role changed to ${nextRole}.`,
      )

      await loadAdminUsers()
    } catch {
      setDashboardError('Could not connect while updating role.')
    }
  }

  function beginEdit(item: DocumentItem) {
    setEditingDocumentId(item.id)
    setEditingTitle(item.title)
    setEditingCategory(item.category)
    setDashboardError('')
    setDashboardMessage('')
  }

  async function saveDocumentEdit(item: DocumentItem) {
    if (!editingTitle.trim() || !editingCategory.trim()) {
      setDashboardError('Title and category are required.')
      return
    }

    try {
      const response = await apiRequest(`/documents/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editingTitle.trim(),
          category: editingCategory.trim(),
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setDashboardError(data.error || 'Could not update document.')
        return
      }

      setDashboardMessage('Document details updated.')
      setEditingDocumentId(null)
      await loadDocuments()
    } catch {
      setDashboardError('Could not connect while updating document.')
    }
  }

  async function deleteDocument(item: DocumentItem) {
    if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) {
      return
    }

    try {
      const response = await apiRequest(`/documents/${item.id}`, {
        method: 'DELETE',
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setDashboardError(data.error || 'Could not delete document.')
        return
      }

      setDashboardMessage('Document deleted.')
      await loadDocuments()
    } catch {
      setDashboardError('Could not connect while deleting document.')
    }
  }

  async function grantPermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const documentId = Number(grantDocumentId)

    if (
      !Number.isInteger(documentId) ||
      documentId < 1 ||
      !grantEmail.trim()
    ) {
      setDashboardError('Enter a valid document ID and email.')
      return
    }

    try {
      const response = await apiRequest(
        `/documents/${documentId}/permissions`,
        {
          method: 'POST',
          body: JSON.stringify({
            email: grantEmail.trim(),
            access_level: grantLevel,
          }),
        },
      )

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setDashboardError(data.error || 'Could not grant permission.')
        return
      }

      setDashboardMessage(
        `Granted ${grantLevel} access to ${grantEmail.trim()}.`,
      )
      setGrantEmail('')
    } catch {
      setDashboardError('Could not connect while granting permission.')
    }
  }

  async function revokePermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const documentId = Number(revokeDocumentId)
    const targetUserId = Number(revokeUserId)

    if (
      !Number.isInteger(documentId) ||
      documentId < 1 ||
      !Number.isInteger(targetUserId) ||
      targetUserId < 1
    ) {
      setDashboardError('Enter valid document and user IDs.')
      return
    }

    if (
      !window.confirm(
        `Revoke access for user ${targetUserId} to document ${documentId}?`,
      )
    ) {
      return
    }

    try {
      const response = await apiRequest(
        `/documents/${documentId}/permissions/${targetUserId}`,
        { method: 'DELETE' },
      )

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setDashboardError(data.error || 'Could not revoke permission.')
        return
      }

      setDashboardMessage('Permission revoked. The change applies immediately.')
      setRevokeUserId('')
    } catch {
      setDashboardError('Could not connect while revoking permission.')
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
        setDashboardError(
          data.error || 'Download failed or access was denied.',
        )
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

  const documentCategories = Array.from(
    new Set(documents.map((item) => item.category.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b))

  const filteredDocuments = documents
    .filter((item) => {
      const query = search.trim().toLowerCase()
      const matchesSearch =
        item.title.toLowerCase().includes(query) ||
        item.original_filename.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query)
      const matchesCategory =
        documentCategoryFilter === 'all' ||
        item.category.trim().toLowerCase() === documentCategoryFilter.toLowerCase()

      return matchesSearch && matchesCategory
    })
    .sort((a, b) => {
      const nameComparison = a.title.localeCompare(b.title, undefined, {
        sensitivity: 'base',
        numeric: true,
      })
      return documentSort === 'name-asc' ? nameComparison : -nameComparison
    })

  const filteredAuditLogs = auditLogs
    .filter((log) => {
      const query = auditFilters.keyword.trim().toLowerCase()
      const searchable = [
        log.action,
        log.resource_type,
        log.resource_id,
        log.outcome,
        log.actor_id,
        log.actor_name,
        log.actor_email,
        log.ip_address,
        typeof log.details === 'string'
          ? log.details
          : JSON.stringify(log.details ?? {}),
      ]
        .map((value) => String(value ?? ''))
        .join(' ')
        .toLowerCase()

      if (query && !searchable.includes(query)) return false

      const timestamp = parseAuditTimestamp(log.created_at).getTime()
      if (auditFilters.from) {
        const from = auditDateBoundary(auditFilters.from)
        if (!Number.isNaN(from) && timestamp < from) return false
      }
      if (auditFilters.to) {
        const to = auditDateBoundary(auditFilters.to, true)
        if (!Number.isNaN(to) && timestamp > to) return false
      }

      const action = log.action.toLowerCase()
      const resource = log.resource_type.toLowerCase()
      const isLoginEvent = /login|auth|logout|session/.test(`${action} ${resource}`)
      const isDocumentEvent = /document|file|upload|download/.test(`${action} ${resource}`)
      if (auditSection === 'login' && !isLoginEvent) return false
      if (auditSection === 'document' && !isDocumentEvent) return false
      if (auditFilters.type === 'login' && !/login|auth/.test(action)) return false
      if (auditFilters.type === 'document' && !/document|file/.test(`${action} ${resource}`)) return false
      if (auditFilters.type === 'permission' && !/permission|access|grant|revoke/.test(`${action} ${resource}`)) return false
      if (auditFilters.type === 'user' && !/user|role|profile/.test(`${action} ${resource}`)) return false
      if (auditFilters.type === 'other' && /login|auth|document|file|permission|access|grant|revoke|user|role|profile/.test(`${action} ${resource}`)) return false

      const successful = ['success', 'allowed'].includes(log.outcome.toLowerCase())
      if (auditFilters.outcome === 'success' && !successful) return false
      if (auditFilters.outcome === 'failure' && successful) return false
      return true
    })
    .sort((a, b) => {
      const difference = parseAuditTimestamp(a.created_at).getTime() - parseAuditTimestamp(b.created_at).getTime()
      return auditSort === 'newest' ? -difference : difference
    })

  function applyAuditFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (auditFromDraft && auditToDraft && auditFromDraft > auditToDraft) {
      setDashboardError('From date must be on or before To date.')
      return
    }

    setDashboardError('')
    setAuditFilters({
      keyword: auditKeywordDraft,
      from: auditFromDraft,
      to: auditToDraft,
      type: auditTypeDraft,
      outcome: auditOutcomeDraft,
    })
  }

  function clearAuditFilters() {
    setAuditKeywordDraft('')
    setAuditFromDraft('')
    setAuditToDraft('')
    setAuditTypeDraft('all')
    setAuditOutcomeDraft('all')
    setAuditSort('newest')
    setAuditFilters({
      keyword: '',
      from: '',
      to: '',
      type: 'all',
      outcome: 'all',
    })
    setDashboardError('')
  }

  // PART 2 continues from here.
  // Do not add another function App() in Part 2.

  if (user) {
    const isOwner = user.role.toLowerCase() === 'owner'
    const isAdmin = user.role.toLowerCase() === 'admin'

    return (
      <main className="dashboard-app">
        <aside className="dashboard-sidebar">
          <a className="brand dashboard-brand" href="#" aria-label="TrustVault">
            <span className="brand-mark">
              <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
                <path d="M20 4 33 9v10c0 8-5.5 13.5-13 17C12.5 32.5 7 27 7 19V9L20 4Z" stroke="currentColor" strokeWidth="2.5" />
                <path d="m13.5 19.5 4.5 4.5 9-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="brand-word">Trust<span>Vault</span></span>
          </a>

          <div className="sidebar-label">WORKSPACE</div>

          {isOwner && <>
            <button type="button" className={`sidebar-link ${activeTab === 'ownerDashboard' ? 'active' : ''}`} onClick={() => setActiveTab('ownerDashboard')}><span>▦</span> Dashboard</button>
            <button type="button" className={`sidebar-link ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => { setActiveTab('documents'); void loadDocuments() }}><span>▤</span> Uploaded Documents</button>
            <button type="button" className={`sidebar-link ${activeTab === 'upload' ? 'active' : ''}`} onClick={() => setActiveTab('upload')}><span>↑</span> Upload Document</button>
            <button type="button" className={`sidebar-link ${activeTab === 'access' ? 'active' : ''}`} onClick={() => setActiveTab('access')}><span>♙</span> Manage Access</button>
            <button type="button" className={`sidebar-link ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')}><span>◷</span> Document Activity</button>
            <button type="button" className={`sidebar-link ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}><span>●</span> My Profile</button>
          </>}

          {isAdmin && <button type="button" className={`sidebar-link ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}><span>▦</span> Admin dashboard</button>}

          {!isOwner && <button type="button" className={`sidebar-link ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => { setActiveTab('documents'); void loadDocuments() }}><span>▤</span> {isAdmin ? 'Uploaded Documents' : 'Documents'}</button>}

          {isAdmin && <>
            <button type="button" className={`sidebar-link ${activeTab === 'upload' ? 'active' : ''}`} onClick={() => setActiveTab('upload')}><span>↑</span> Upload Document</button>
            <button type="button" className={`sidebar-link ${activeTab === 'access' ? 'active' : ''}`} onClick={() => setActiveTab('access')}><span>♙</span> Manage Access</button>
          </>}

          {isAdmin && <>
            <button type="button" className={`sidebar-link ${activeTab === 'users' ? 'active' : ''}`} onClick={() => { setActiveTab('users'); void loadAdminUsers() }}><span>♙</span> User management</button>
            <button type="button" className={`sidebar-link ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => { setActiveTab('audit'); void loadAuditLogs() }}><span>◷</span> Audit trail</button>
            <button type="button" className={`sidebar-link ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}><span>●</span> My Profile</button>
            <button type="button" className={`sidebar-link ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}><span>⚙</span> Settings</button>
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
              <h1>
                {activeTab === 'ownerDashboard' ? 'Dashboard'
                  : activeTab === 'upload' ? 'Upload Document'
                  : activeTab === 'access' ? 'Manage Access'
                  : activeTab === 'activity' ? 'Document Activity'
                  : activeTab === 'profile' ? 'My Profile'
                  : activeTab === 'settings' ? 'Settings'
                  : activeTab === 'users' ? 'User Management'
                  : activeTab === 'audit' ? 'Audit Trail'
                  : activeTab === 'overview' ? 'Admin Dashboard'
                  : isOwner ? 'Uploaded Documents' : 'Documents'}
              </h1>
              <p>
                {activeTab === 'ownerDashboard' ? 'A clear overview of your secure document workspace.'
                  : activeTab === 'upload' ? 'Add a document to your workspace securely.'
                  : activeTab === 'access' ? 'Control who can read or edit your documents.'
                  : activeTab === 'activity' ? 'Review the activity available for your account.'
                  : activeTab === 'profile' ? 'Your TrustVault account information.'
                  : activeTab === 'settings' ? 'Manage your workspace preferences and security options.'
                  : 'Manage and access your files in one secure place.'}
              </p>
            </div>
            <div className="secure-indicator"><span className="status-dot" /> Secure session</div>
          </header>

          {(activeTab === 'ownerDashboard' || !isOwner) && (
            <section className="dashboard-welcome">
              <div>
                <span className="welcome-kicker">YOUR WORKSPACE</span>
                <h2>Welcome, {user.name}</h2>
                <p>
                  {isOwner ? 'Upload documents and keep access under your control.'
                    : isAdmin ? 'Review available documents in your workspace.'
                    : 'Open the documents shared with you and download permitted files.'}
                </p>
              </div>
              <div className="role-chip">Role: {user.role}</div>
            </section>
          )}

          {!isOwner && (
            <section className="dashboard-stats">
              <article className="dashboard-stat"><span className="stat-icon">▤</span><span className="stat-label">Available documents</span><strong>{documents.length}</strong><small>Documents visible to your account</small></article>
              <article className="dashboard-stat"><span className="stat-icon gold-stat-icon">⌕</span><span className="stat-label">Search results</span><strong>{filteredDocuments.length}</strong><small>Matching your current search</small></article>
              <article className="dashboard-stat"><span className="stat-icon green-stat-icon">✓</span><span className="stat-label">Session status</span><strong className="session-active">Active</strong><small>Authenticated workspace</small></article>
            </section>
          )}

          {dashboardMessage && <div className="dashboard-alert dashboard-success" role="status"><span>✓</span> {dashboardMessage}</div>}
          {dashboardError && <div className="dashboard-alert dashboard-danger" role="alert">{dashboardError}</div>}

          {isOwner && activeTab === 'ownerDashboard' && <>
            <section className="owner-dashboard-grid">
              <article className="owner-stat-card"><span className="owner-stat-icon">▤</span><div><span>My Documents</span><strong>{documents.length}</strong><small>Files available in your workspace</small></div></article>
              <article className="owner-stat-card"><span className="owner-stat-icon owner-stat-gold">↑</span><div><span>Quick Action</span><strong className="owner-stat-action">Upload a file</strong><small>Add a new document securely</small><button className="small-action" onClick={() => setActiveTab('upload')}>Upload document →</button></div></article>
              <article className="owner-stat-card"><span className="owner-stat-icon owner-stat-green">✓</span><div><span>Session Status</span><strong className="session-active">Active</strong><small>Authenticated workspace</small></div></article>
            </section>
            <section className="owner-dashboard-columns">
              <article className="dashboard-panel owner-shortcut-panel"><div className="panel-heading"><div><h2>Quick Actions</h2><p>Jump straight to a task.</p></div></div><div className="owner-quick-actions"><button onClick={() => setActiveTab('upload')}><span>↑</span><div><strong>Upload Document</strong><small>Add a new file to your vault</small></div><b>›</b></button><button onClick={() => setActiveTab('access')}><span>♙</span><div><strong>Manage Access</strong><small>Grant or revoke document permissions</small></div><b>›</b></button><button onClick={() => setActiveTab('documents')}><span>⌕</span><div><strong>Search Documents</strong><small>Find files in your workspace</small></div><b>›</b></button></div></article>
              <article className="dashboard-panel owner-recent-panel">
                <div className="panel-heading"><div><h2>Recent Documents</h2><p>Your latest available files.</p></div><button className="refresh-button" onClick={() => setActiveTab('documents')}>View all →</button></div>
                {documents.length ? <div className="owner-recent-list">{[...documents].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 4).map(item => <div className="owner-recent-item" key={item.id}><span className="owner-file-icon">PDF</span><div><strong>{item.title}</strong><small>{item.category} · {new Date(item.created_at).toLocaleDateString()}</small></div><button className="refresh-button" onClick={() => void handleDownload(item)}>Download</button></div>)}</div> : <p className="admin-hint">No documents are available yet. Upload your first file to get started.</p>}
              </article>
            </section>
          </>}

          {(isOwner || isAdmin) && activeTab === 'profile' && <section className="dashboard-panel owner-profile-panel"><div className="panel-heading"><div><h2>My Profile</h2><p>Account details currently available in TrustVault.</p></div><span className="panel-tag">{isAdmin ? 'ADMIN' : 'OWNER'}</span></div><div className="owner-profile-grid"><div><span>Full name</span><strong>{user.name || 'Not provided'}</strong></div><div><span>Email address</span><strong>{user.email}</strong></div><div><span>Account role</span><strong>{user.role}</strong></div><div><span>Session</span><strong className="session-active">Active</strong></div></div><p className="admin-hint">Profile editing is not enabled yet; these details are read-only.</p></section>}

          {isAdmin && activeTab === 'settings' && (
            <section className="dashboard-panel management-panel settings-panel">
              <div className="panel-heading">
                <div><h2>Workspace settings</h2><p>Manage preferences for this browser session.</p></div>
                <span className="panel-tag">ADMIN</span>
              </div>

              <div className="settings-group">
                <div className="settings-group-heading"><h3>Preferences</h3><p>These switches are local UI preferences and are not saved to the server.</p></div>
                <label className="settings-row">
                  <span><strong>Email notifications</strong><small>Preference for receiving workspace update notifications.</small></span>
                  <input type="checkbox" checked={emailNotifications} onChange={event => setEmailNotifications(event.target.checked)} />
                </label>
                <label className="settings-row">
                  <span><strong>Security alerts</strong><small>Show preference for important security-related notices.</small></span>
                  <input type="checkbox" checked={securityAlerts} onChange={event => setSecurityAlerts(event.target.checked)} />
                </label>
                <label className="settings-row">
                  <span><strong>Compact view</strong><small>Use a denser layout preference for workspace content.</small></span>
                  <input type="checkbox" checked={compactView} onChange={event => setCompactView(event.target.checked)} />
                </label>
              </div>

              <div className="settings-group">
                <div className="settings-group-heading"><h3>Account security</h3><p>Current session information.</p></div>
                <div className="settings-security-grid">
                  <div><span>Session status</span><strong className="session-active">Active</strong></div>
                  <div><span>Signed-in account</span><strong>{user.email}</strong></div>
                  <div><span>Role</span><strong>{user.role}</strong></div>
                </div>
                <button type="button" className="danger-action settings-signout" onClick={handleLogout}>Sign out of TrustVault</button>
              </div>
            </section>
          )}

          {isOwner && activeTab === 'activity' && <section className="dashboard-panel"><div className="panel-heading"><div><h2>Document Activity</h2><p>Activity history for your documents.</p></div></div><div className="dashboard-empty"><div className="empty-symbol">◷</div><h3>Activity feed is not available yet</h3><p>The current backend does not expose an owner-specific document activity feed. No sample events are shown as real activity.</p></div></section>}

          {isAdmin && activeTab === 'overview' && (
            <section className="dashboard-panel management-panel admin-overview">
              <div className="panel-heading"><div><h2>Admin dashboard</h2><p>Security and account controls for the TrustVault workspace.</p></div><span className="panel-tag">ADMIN</span></div>
              <div className="admin-overview-grid">
                <article className="admin-overview-card"><span className="stat-icon">▤</span><h3>Documents</h3><p>View, search, edit, and manage uploaded documents.</p><button className="small-action" onClick={() => { setActiveTab('documents'); void loadDocuments() }}>Open documents →</button></article>
                <article className="admin-overview-card"><span className="stat-icon">↑</span><h3>Upload document</h3><p>Add a document with a title and category.</p><button className="small-action" onClick={() => setActiveTab('upload')}>Upload document →</button></article>
                <article className="admin-overview-card"><span className="stat-icon">♙</span><h3>Manage access</h3><p>Grant or revoke document permissions.</p><button className="small-action" onClick={() => setActiveTab('access')}>Manage access →</button></article>
                <article className="admin-overview-card"><span className="stat-icon">♙</span><h3>User management</h3><p>Review registered accounts and manage roles.</p><button className="small-action" onClick={() => { setActiveTab('users'); void loadAdminUsers() }}>Open user management →</button></article>
                <article className="admin-overview-card"><span className="stat-icon gold-stat-icon">◷</span><h3>Audit trail</h3><p>Review security events and check the audit chain.</p><button className="small-action" onClick={() => { setActiveTab('audit'); void loadAuditLogs() }}>Open audit trail →</button></article>
                <article className="admin-overview-card"><span className="stat-icon green-stat-icon">✓</span><h3>Integrity check</h3><p>Run server-side audit-chain verification.</p><button className="small-action" onClick={() => void verifyAuditChain()}>Verify audit chain</button></article>
              </div>
              {auditVerification && <div className={`verification-result ${auditVerification.valid ? 'verification-ok' : 'verification-fail'}`} role="status"><strong>{auditVerification.valid ? 'Audit chain valid' : 'Audit chain verification failed'}</strong><span>{String(auditVerification.entries_checked ?? 0)} entries checked</span></div>}
            </section>
          )}

          {isAdmin && activeTab === 'users' && (
            <section className="dashboard-panel management-panel">
              <div className="panel-heading">
                <div><h2>User management</h2><p>Search accounts, filter by role, and manage user access.</p></div>
                <button className="refresh-button" onClick={() => void loadAdminUsers()} disabled={adminUsersLoading}>{adminUsersLoading ? 'Loading…' : '↻ Refresh'}</button>
              </div>

              <div className="user-management-filters">
                <input type="search" value={adminUserSearch} onChange={event => setAdminUserSearch(event.target.value)} placeholder="Search by name or email..." aria-label="Search users by name or email" />
                <select value={adminUserRoleFilter} onChange={event => setAdminUserRoleFilter(event.target.value as 'all' | 'admin' | 'owner' | 'viewer')} aria-label="Filter users by role">
                  <option value="all">All roles</option><option value="admin">Admin</option><option value="owner">Owner</option><option value="viewer">Viewer</option>
                </select>
                <select value={adminUserSort} onChange={event => setAdminUserSort(event.target.value as 'name' | 'email' | 'role')} aria-label="Sort users">
                  <option value="name">Sort by name</option><option value="email">Sort by email</option><option value="role">Sort by role</option>
                </select>
              </div>

              {adminUsersLoading ? <p className="admin-hint">Loading users…</p> : (() => {
                const query = adminUserSearch.trim().toLowerCase()
                const filteredUsers = adminUsers.filter(person => {
                  const matchesSearch = (person.name || '').toLowerCase().includes(query) || person.email.toLowerCase().includes(query)
                  const matchesRole = adminUserRoleFilter === 'all' || person.role.toLowerCase() === adminUserRoleFilter
                  return matchesSearch && matchesRole
                }).sort((a, b) => String(a[adminUserSort] || '').toLowerCase().localeCompare(String(b[adminUserSort] || '').toLowerCase()))

                if (filteredUsers.length === 0) return <p className="admin-hint">No matching users found.</p>

                return (
                  <div className="table-scroll">
                    <table className="admin-table">
                      <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Action</th></tr></thead>
                      <tbody>
                        {filteredUsers.map(person => {
                          const role = person.role.toLowerCase()
                          return (
                            <tr key={person.id}>
                              <td>{person.name || '—'}</td>
                              <td>{person.email}</td>
                              <td><span className="role-chip">{person.role}</span></td>
                              <td>
                                {role === 'viewer' ? <button className="small-action" onClick={() => void changeUserRole(person, 'owner')}>Promote to owner</button>
                                  : role === 'owner' ? <button className="danger-action" onClick={() => void changeUserRole(person, 'viewer')}>Change to viewer</button>
                                  : <span className="admin-hint">No action</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })()}
            </section>
          )}

          {isAdmin && activeTab === 'audit' && (
            <section className="audit-page">
              <div className="audit-page-heading">
                <div>
                  <div className="audit-page-kicker">SECURITY & COMPLIANCE</div>
                  <h2>Audit Trail</h2>
                  <p>Track security events, investigate activity, and verify audit integrity.</p>
                </div>
                <div className="audit-heading-actions">
                  <span className="audit-secure-pill"><span /> Secure session</span>
                  <button type="button" className="audit-verify-button" onClick={() => void verifyAuditChain()} disabled={auditLoading}>
                    <span>♢</span> Verify chain integrity
                  </button>
                </div>
              </div>

              {dashboardError && <div className="audit-inline-alert audit-alert-error" role="alert">{dashboardError}</div>}
              {dashboardMessage && <div className="audit-inline-alert audit-alert-success" role="status">{dashboardMessage}</div>}

              <div className="audit-stat-grid">
                <article className="audit-stat-card audit-stat-blue">
                  <div className="audit-stat-top"><span className="audit-stat-icon">▤</span><span className="audit-stat-label">Total events</span></div>
                  <strong>{auditStats.total_events.toLocaleString()}</strong>
                  <small>Recorded security events</small>
                  <svg className="audit-sparkline" viewBox="0 0 220 28" preserveAspectRatio="none" aria-hidden="true"><path d="M0 22 L18 17 L35 20 L52 10 L70 14 L88 8 L105 15 L123 11 L140 17 L158 8 L176 12 L194 5 L220 9" /></svg>
                </article>
                <article className="audit-stat-card audit-stat-green">
                  <div className="audit-stat-top"><span className="audit-stat-icon">✓</span><span className="audit-stat-label">Successful events</span></div>
                  <strong>{auditStats.successful_events.toLocaleString()}</strong>
                  <small>Successful / allowed actions</small>
                  <svg className="audit-sparkline" viewBox="0 0 220 28" preserveAspectRatio="none" aria-hidden="true"><path d="M0 23 L18 17 L35 19 L52 12 L70 14 L88 8 L105 13 L123 7 L140 11 L158 6 L176 10 L194 4 L220 6" /></svg>
                </article>
                <article className="audit-stat-card audit-stat-red">
                  <div className="audit-stat-top"><span className="audit-stat-icon">!</span><span className="audit-stat-label">Failed events</span></div>
                  <strong>{auditStats.failed_events.toLocaleString()}</strong>
                  <small>Failed or denied actions</small>
                  <svg className="audit-sparkline" viewBox="0 0 220 28" preserveAspectRatio="none" aria-hidden="true"><path d="M0 8 L18 13 L35 7 L52 18 L70 11 L88 20 L105 10 L123 15 L140 7 L158 18 L176 12 L194 16 L220 8" /></svg>
                </article>
                <article className="audit-stat-card audit-stat-purple">
                  <div className="audit-stat-top"><span className="audit-stat-icon">◉</span><span className="audit-stat-label">Login events</span></div>
                  <strong>{auditStats.login_events.toLocaleString()}</strong>
                  <small>Login and authentication activity</small>
                  <svg className="audit-sparkline" viewBox="0 0 220 28" preserveAspectRatio="none" aria-hidden="true"><path d="M0 21 L18 14 L35 17 L52 10 L70 13 L88 8 L105 12 L123 6 L140 13 L158 9 L176 16 L194 10 L220 13" /></svg>
                </article>
              </div>

              <div className="audit-category-tabs" role="tablist" aria-label="Audit trail categories">
                <button type="button" role="tab" aria-selected={auditSection === 'login'} className={auditSection === 'login' ? 'active' : ''} onClick={() => { setAuditSection('login'); setSelectedAuditLog(null); setAuditFilters(current => ({ ...current, type: 'all' })); setAuditTypeDraft('all') }}>
                  <span>◉</span><strong>Login Audit Trail</strong><small>Login, authentication and session activity</small>
                </button>
                <button type="button" role="tab" aria-selected={auditSection === 'document'} className={auditSection === 'document' ? 'active' : ''} onClick={() => { setAuditSection('document'); setSelectedAuditLog(null); setAuditFilters(current => ({ ...current, type: 'all' })); setAuditTypeDraft('all') }}>
                  <span>▤</span><strong>Document Audit Trail</strong><small>Uploads, downloads and document changes</small>
                </button>
              </div>

              <form className="audit-filter-form audit-filter-form-modern" onSubmit={applyAuditFilters}>
                <label>Search events<input value={auditKeywordDraft} onChange={event => setAuditKeywordDraft(event.target.value)} placeholder="Action, resource, actor, IP, details…" /></label>
                <label>From date<input type="date" value={auditFromDraft} onChange={event => setAuditFromDraft(event.target.value)} /></label>
                <label>To date<input type="date" value={auditToDraft} onChange={event => setAuditToDraft(event.target.value)} /></label>
                <label>Event type<select value={auditTypeDraft} onChange={event => setAuditTypeDraft(event.target.value as 'all' | 'login' | 'document' | 'permission' | 'user' | 'other')}><option value="all">All event types</option><option value="login">Login / authentication</option><option value="document">Document activity</option><option value="permission">Permissions / access</option><option value="user">User / role changes</option><option value="other">Other events</option></select></label>
                <label>Outcome<select value={auditOutcomeDraft} onChange={event => setAuditOutcomeDraft(event.target.value as 'all' | 'success' | 'failure')}><option value="all">All outcomes</option><option value="success">Success / allowed</option><option value="failure">Failed / denied</option></select></label>
                <div className="audit-filter-actions"><button className="audit-search-button" type="submit">Search</button><button className="refresh-button" type="button" onClick={clearAuditFilters}>Clear</button></div>
              </form>

              {auditVerification && <div className={`verification-result ${auditVerification.valid ? 'verification-ok' : 'verification-fail'}`} role="status">
                <strong>{auditVerification.valid ? '✓ Audit chain integrity verified' : '⚠ Audit chain verification failed'}</strong>
                <span>{String(auditVerification.entries_checked ?? 0)} entries checked</span>
                {auditVerification.entry_id ? <span>Issue at event #{String(auditVerification.entry_id)}</span> : null}
                {auditVerification.reason ? <span>{String(auditVerification.reason)}</span> : null}
                {auditVerification.last_hash ? <code>Last hash: {String(auditVerification.last_hash)}</code> : null}
              </div>}

              <div className={`audit-workspace ${selectedAuditLog ? 'has-selection' : ''}`}>
                <section className="audit-events-card">
                  <div className="audit-events-heading">
                    <div><h3>{auditSection === 'login' ? 'Login Events' : 'Document Events'}</h3><p>Showing {filteredAuditLogs.length.toLocaleString()} matching events{auditLoading ? ' · loading…' : ''}</p></div>
                    <div className="audit-table-actions">
                      <label>Sort by<select value={auditSort} onChange={event => setAuditSort(event.target.value as 'newest' | 'oldest')}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
                      <button type="button" className="refresh-button" onClick={() => void loadAuditLogs()} disabled={auditLoading}>{auditLoading ? 'Loading…' : '↻ Refresh'}</button>
                      <button type="button" className="refresh-button audit-export-button" onClick={exportAuditCsv} disabled={filteredAuditLogs.length === 0}>⇩ Export CSV</button>
                    </div>
                  </div>

                  {auditLoading ? <div className="audit-empty-state">Loading audit events…</div>
                    : filteredAuditLogs.length === 0 ? <div className="audit-empty-state"><strong>No audit events found</strong><span>Try changing or clearing your filters.</span></div>
                    : <div className="audit-table-scroll"><table className="audit-events-table"><thead><tr><th>Time</th><th>Action</th><th>Resource</th><th>Outcome</th><th>Actor</th><th>IP address</th><th>Details</th></tr></thead><tbody>
                      {filteredAuditLogs.map(log => {
                        const successful = ['success', 'allowed'].includes(log.outcome.toLowerCase())
                        const action = log.action.toLowerCase()
                        const eventIcon = /login|auth/.test(action) ? '◉' : /delete|revoke|fail|denied/.test(action) ? '!' : /upload|create/.test(action) ? '⇧' : /permission|grant|access/.test(action) ? '⚿' : /document|download|view/.test(`${action} ${log.resource_type.toLowerCase()}`) ? '▤' : '↻'
                        return <tr key={log.id} className={selectedAuditLog?.id === log.id ? 'audit-row-selected' : ''} onClick={() => setSelectedAuditLog(log)}>
                          <td><span className="audit-event-time">{formatAuditDate(log.created_at)}</span><small>{formatAuditTime(log.created_at)}</small></td>
                          <td><span className={`audit-action-icon ${successful ? 'action-icon-good' : 'action-icon-bad'}`}>{eventIcon}</span><strong className="audit-action-name">{log.action}</strong></td>
                          <td><span className="audit-resource-name">{log.resource_type}{log.resource_id ? ` #${log.resource_id}` : ''}</span></td>
                          <td><span className={`audit-outcome-pill ${successful ? 'audit-outcome-success' : 'audit-outcome-failure'}`}>{log.outcome}</span></td>
                          <td><strong className="audit-actor-name">{log.actor_name || (log.actor_id != null ? `User #${log.actor_id}` : 'System')}</strong><small>{log.actor_email || (log.actor_id == null ? 'System / unknown' : `ID ${log.actor_id}`)}</small></td>
                          <td className="audit-ip-cell">{log.ip_address || '—'}</td>
                          <td><button type="button" className="audit-view-details" onClick={event => { event.stopPropagation(); setSelectedAuditLog(log) }}>› View details</button></td>
                        </tr>
                      })}
                    </tbody></table></div>}
                </section>

                {selectedAuditLog && (
                  <aside className="audit-detail-card" aria-label="Selected audit event details">
                    <div className="audit-detail-heading"><h3>Event Details</h3><button type="button" aria-label="Close event details" onClick={() => setSelectedAuditLog(null)}>×</button></div>
                    <div className={`audit-detail-status ${['success', 'allowed'].includes(selectedAuditLog.outcome.toLowerCase()) ? 'detail-status-good' : 'detail-status-bad'}`}>
                      <span>{['success', 'allowed'].includes(selectedAuditLog.outcome.toLowerCase()) ? '✓' : '!'}</span>
                      <div><strong>{selectedAuditLog.action}</strong><small>{['success', 'allowed'].includes(selectedAuditLog.outcome.toLowerCase()) ? 'Action completed successfully' : 'Action failed or was denied'}</small></div>
                    </div>
                    <dl className="audit-detail-list">
                      <div><dt>Event ID</dt><dd>#{selectedAuditLog.id}</dd></div>
                      <div><dt>Timestamp</dt><dd>{formatAuditDateTime(selectedAuditLog.created_at)}</dd></div>
                      <div><dt>Event type</dt><dd><span className="audit-detail-tag">{selectedAuditLog.action}</span></dd></div>
                      <div><dt>Outcome</dt><dd><span className={`audit-outcome-pill ${['success', 'allowed'].includes(selectedAuditLog.outcome.toLowerCase()) ? 'audit-outcome-success' : 'audit-outcome-failure'}`}>{selectedAuditLog.outcome}</span></dd></div>
                      <div><dt>Actor</dt><dd><strong>{selectedAuditLog.actor_name || (selectedAuditLog.actor_id != null ? `User #${selectedAuditLog.actor_id}` : 'System / unknown')}</strong>{selectedAuditLog.actor_email && <small>{selectedAuditLog.actor_email}</small>}</dd></div>
                      <div><dt>Resource</dt><dd>{selectedAuditLog.resource_type}{selectedAuditLog.resource_id ? ` #${selectedAuditLog.resource_id}` : ''}</dd></div>
                      {(() => {
                        const metadata = (selectedAuditLog.details && typeof selectedAuditLog.details === 'object' ? selectedAuditLog.details : {}) as Record<string, unknown>
                        const filename = metadata.filename ?? metadata.original_filename
                        const size = metadata.size_bytes ?? metadata.file_size ?? metadata.size
                        const formatSize = (value: unknown) => {
                          const bytes = Number(value)
                          if (!Number.isFinite(bytes) || bytes < 0) return String(value ?? '')
                          if (bytes < 1024) return `${bytes} B`
                          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
                          return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
                        }
                        return <>
                          {filename != null && <div><dt>Filename</dt><dd>{String(filename)}</dd></div>}
                          {size != null && <div><dt>File size</dt><dd>{formatSize(size)}</dd></div>}
                          {metadata.category != null && <div><dt>Category</dt><dd>{String(metadata.category)}</dd></div>}
                          {metadata.reason != null && <div><dt>Reason</dt><dd>{String(metadata.reason).replaceAll('_', ' ')}</dd></div>}
                        </>
                      })()}
                      <div><dt>IP address</dt><dd>{selectedAuditLog.ip_address || 'Not recorded'}</dd></div>
                    </dl>
                    <div className="audit-detail-json"><h4>Event metadata</h4><pre>{JSON.stringify(selectedAuditLog.details ?? {}, null, 2)}</pre></div>
                  </aside>
                )}
              </div>
            </section>
          )}
          {activeTab === 'access' && (isOwner || isAdmin) && (
            <section className="dashboard-panel management-panel">
              <div className="panel-heading"><div><h2>Document permissions</h2><p>Grant read/edit access or revoke an existing grant.</p></div><span className="panel-tag">OWNER</span></div>
              <form className="permission-form" onSubmit={grantPermission}><h3>Grant access</h3><div className="permission-fields"><label>
  Select document
  <select
    value={grantDocumentId}
    onChange={event => setGrantDocumentId(event.target.value)}
    required
  >
    <option value="">Choose a document</option>
    {documents.map(document => (
      <option key={document.id} value={document.id}>
        {document.title} (ID: {document.id})
      </option>
    ))}
  </select>
</label><label>User email<input type="email" value={grantEmail} onChange={event => setGrantEmail(event.target.value)} placeholder="person@example.com" required /></label><label>Access level<select value={grantLevel} onChange={event => setGrantLevel(event.target.value as 'read' | 'edit')}><option value="read">Read only</option><option value="edit">Read and edit</option></select></label><button className="small-action" type="submit">Grant access</button></div></form>
              <form className="permission-form revoke-form" onSubmit={revokePermission}><h3>Revoke access</h3><p className="admin-hint">Enter the document ID and target user's numeric ID.</p><div className="permission-fields"><label>
  Select document
  <select
    value={revokeDocumentId}
    onChange={event => setRevokeDocumentId(event.target.value)}
    required
  >
    <option value="">Choose a document</option>
    {documents.map(document => (
      <option key={document.id} value={document.id}>
        {document.title} (ID: {document.id})
      </option>
    ))}
  </select>
</label><label>Target user ID<input type="number" min="1" value={revokeUserId} onChange={event => setRevokeUserId(event.target.value)} placeholder="e.g. 4" required /></label><button className="danger-action" type="submit">Revoke access</button></div></form>
            </section>
          )}

          {activeTab === 'upload' && (isOwner || isAdmin) && (
            <section className="dashboard-panel">
              <div className="panel-heading"><div><h2>Upload a document</h2><p>Add a file to your secure workspace.</p></div><span className="panel-tag">{isAdmin ? 'ADMIN' : 'OWNER'}</span></div>
              <form className="upload-form" onSubmit={handleUpload}>
                <div className="upload-fields">
                  <div className="form-field"><label htmlFor="upload-title">Document title</label><input id="upload-title" value={uploadTitle} onChange={event => setUploadTitle(event.target.value)} placeholder="e.g. Project agreement" maxLength={255} required /></div>
                  <div className="form-field"><label htmlFor="upload-category">Category</label><input id="upload-category" value={uploadCategory} onChange={event => setUploadCategory(event.target.value)} placeholder="e.g. Work, Personal" maxLength={100} required /></div>
                  <div className="form-field upload-file-field"><label htmlFor="upload-file">Choose file</label><input id="upload-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" onChange={event => setUploadFile(event.target.files?.[0] || null)} required /><small>PDF, PNG, JPG, JPEG or TXT</small></div>
                </div>
                <button className="primary-button upload-button" type="submit" disabled={uploading}>{uploading ? 'Uploading…' : 'Upload securely'} <span>→</span></button>
              </form>
            </section>
          )}

          {activeTab === 'documents' && (
            <section className="dashboard-panel documents-panel">
              <div className="panel-heading documents-heading"><div><h2>Your documents</h2><p>Only files permitted for your account can be downloaded.</p></div><button className="refresh-button" onClick={() => void loadDocuments()} disabled={documentsLoading}>↻ Refresh</button></div>
              <div className="document-filters">
                <div className="document-search">
                  <span>⌕</span>
                  <input
                    aria-label="Search documents"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Search by title, filename or category..."
                  />
                </div>
                <label className="document-filter-control">
                  <span>Category</span>
                  <select
                    aria-label="Filter documents by category"
                    value={documentCategoryFilter}
                    onChange={event => setDocumentCategoryFilter(event.target.value)}
                  >
                    <option value="all">All categories</option>
                    {documentCategories.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <label className="document-filter-control">
                  <span>Sort by name</span>
                  <select
                    aria-label="Sort documents by name"
                    value={documentSort}
                    onChange={event => setDocumentSort(event.target.value as 'name-asc' | 'name-desc')}
                  >
                    <option value="name-asc">Name: A–Z</option>
                    <option value="name-desc">Name: Z–A</option>
                  </select>
                </label>
              </div>
              {documentsLoading ? <div className="dashboard-empty"><div className="empty-symbol">↻</div><h3>Loading documents</h3><p>Please wait while we load your workspace.</p></div>
                : documentError ? <div className="dashboard-empty"><h3>Documents could not be loaded</h3><p>{documentError}</p><button className="secondary-button" onClick={() => void loadDocuments()}>Try again</button></div>
                : filteredDocuments.length === 0 ? <div className="dashboard-empty"><div className="empty-symbol">▤</div><h3>{search ? 'No matching documents' : 'No documents yet'}</h3><p>{search ? 'Try a different search term.' : isOwner ? 'Upload your first document using the upload page.' : 'Documents shared with your account will appear here.'}</p></div>
                : <div className="document-list">{filteredDocuments.map(item => <article className="document-row" key={item.id}><div className="document-file-icon">PDF</div><div className="document-details">{editingDocumentId === item.id ? <div className="inline-edit-fields"><input aria-label="Document title" value={editingTitle} onChange={event => setEditingTitle(event.target.value)} maxLength={255} /><input aria-label="Document category" value={editingCategory} onChange={event => setEditingCategory(event.target.value)} maxLength={100} /></div> : <><strong>{item.title}</strong><span>{item.original_filename}</span><div className="document-meta"><span>{item.category}</span><span>{formatBytes(item.size_bytes)}</span><span>{new Date(item.created_at).toLocaleDateString()}</span></div></>}</div><div className="document-actions"><button className="download-button" onClick={() => void handleDownload(item)}>Download <span>↓</span></button>{(isOwner || isAdmin) && (editingDocumentId === item.id ? <><button className="small-action" onClick={() => void saveDocumentEdit(item)}>Save</button><button className="refresh-button" onClick={() => setEditingDocumentId(null)}>Cancel</button></> : <><button className="small-action" onClick={() => beginEdit(item)}>Edit</button><button className="danger-action" onClick={() => void deleteDocument(item)}>Delete</button></>)}</div></article>)}</div>}
            </section>
          )}

          <footer className="dashboard-footer"><span>© 2026 TrustVault</span><span>Secure sharing. Clear control.</span></footer>
        </section>
      </main>
    )
  }

  return (
    <main className="tv-app login-reference-page">
      <div className="login-page-glow login-page-glow-one" aria-hidden="true" />
      <div className="login-page-glow login-page-glow-two" aria-hidden="true" />

      <header className="login-reference-header">
        <a className="login-reference-brand" href="#home" aria-label="TrustVault home">
          <span className="login-reference-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 56 64" fill="none">
              <path d="M28 3 49 13v17c0 13-8.7 23.2-21 30C15.7 53.2 7 43 7 30V13L28 3Z" stroke="currentColor" strokeWidth="3.5" />
              <path d="M28 4v55" stroke="currentColor" strokeWidth="2" opacity=".75" />
              <path d="M20 22h14l8 8v17H20V22Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M34 22v8h8M25 36h10M25 41h10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="login-reference-brand-word">Trust<span>Vault</span></span>
        </a>

        <nav className="login-reference-nav" aria-label="Main navigation">
          <a href="#about">About</a>
          <a href="#features">Features</a>
          <a href="#security">Security</a>
          <a href="#help">Help</a>
        </nav>

        <div className="login-reference-header-actions">
          <span className="login-reference-sun" aria-hidden="true">☼</span>
          <button type="button" className="login-reference-create" onClick={() => switchMode('register')}>Create Account</button>
        </div>
      </header>

      <section className="login-reference-layout" id="home">
        <section className="login-reference-hero" id="about">
          <div className="login-reference-eyebrow"><span /> SECURE DOCUMENT SHARING</div>
          <h1>Share with Confidence,<br /><span>Backed by Proof.</span></h1>
          <p className="login-reference-hero-copy">Secure document sharing with real audit trails.<br />Your documents. Your control. Always traceable.</p>

          <div className="login-reference-features" id="features">
            <div className="login-reference-feature">
              <span className="login-reference-feature-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M16 3 27 8v8c0 7-4.7 11.5-11 14C9 27.5 5 23 5 16V8l11-5Z" stroke="currentColor" strokeWidth="2.3"/><path d="m11 16 3.5 3.5 7-8" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
              <span><strong>Secure</strong><small>End-to-end<br />protection</small></span>
            </div>
            <div className="login-reference-feature">
              <span className="login-reference-feature-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><circle cx="12" cy="10" r="5" stroke="currentColor" strokeWidth="2.3"/><path d="M3 27v-3c0-4 4-7 9-7s9 3 9 7v3H3ZM22 6a5 5 0 0 1 0 10M24 18c3 1 5 3 5 6v3h-5" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
              <span><strong>Share</strong><small>Controlled<br />access</small></span>
            </div>
            <div className="login-reference-feature">
              <span className="login-reference-feature-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M8 3h11l7 7v19H8V3Z" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round"/><path d="M19 3v8h7M12 16h10M12 21h10" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"/></svg></span>
              <span><strong>Audit</strong><small>Real-time<br />audit trail</small></span>
            </div>
            <div className="login-reference-feature">
              <span className="login-reference-feature-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M16 3 27 8v8c0 7-4.7 11.5-11 14C9 27.5 5 23 5 16V8l11-5Z" stroke="currentColor" strokeWidth="2.3"/><path d="m11 16 3.5 3.5 7-8" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
              <span><strong>Verify</strong><small>Tamper-proof<br />integrity</small></span>
            </div>
          </div>

          <div className="login-reference-art" id="security" aria-hidden="true">
            <div className="login-art-grid" />
            <div className="login-art-label login-art-label-left"><span>♙</span> Encrypted</div>
            <div className="login-art-label login-art-label-right"><span>⌯</span> Shared Securely</div>
            <div className="login-art-label login-art-label-bottom"><span>▥</span> Audit Tracked</div>
            <div className="login-art-platform platform-back" />
            <div className="login-art-platform platform-front" />
            <div className="login-art-document doc-one"><span /><span /><span /><span /></div>
            <div className="login-art-document doc-two"><span /><span /><span /><span /></div>
            <div className="login-art-document doc-three"><span /><span /><span /><span /></div>
            <div className="login-art-shield"><svg viewBox="0 0 100 115" fill="none"><path d="M50 4 88 22v31c0 25-16 43-38 56C28 96 12 78 12 53V22L50 4Z" fill="#09234B" stroke="#E5B34F" strokeWidth="5"/><path d="M50 12 80 26v26c0 20-12 34-30 45-18-11-30-25-30-45V26l30-14Z" stroke="#D8E8F8" strokeWidth="2"/><rect x="35" y="45" width="30" height="27" rx="4" fill="#E7B952"/><path d="M41 45v-8a9 9 0 0 1 18 0v8" stroke="#F8E3A5" strokeWidth="5" strokeLinecap="round"/><circle cx="50" cy="57" r="3" fill="#09234B"/></svg></div>
          </div>
          <p className="login-reference-tagline">YOUR DOCUMENTS. YOUR TRUST. ALWAYS TRACEABLE.</p>
        </section>

        <section className="login-reference-auth" aria-label={mode === 'login' ? 'Sign in' : 'Create account'}>
          <div className="login-reference-card">
            <div className="login-card-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 72 82" fill="none"><path d="M36 4 63 17v22c0 17-11 30-27 39C20 69 9 56 9 39V17L36 4Z" stroke="currentColor" strokeWidth="4"/><path d="M36 5v73" stroke="currentColor" strokeWidth="2" opacity=".7"/><path d="M26 27h18l10 10v22H26V27Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/><path d="M44 27v10h10M32 44h16M32 51h16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
            </div>
            <div className="login-card-brand-word">Trust<span>Vault</span></div>
            <p className="login-card-tagline">Your Documents. Your Trust. Always Traceable.</p>
            <div className="login-card-heading">
              <h2>{mode === 'login' ? 'Welcome Back' : 'Create Your Account'}</h2>
              <p>{mode === 'login' ? 'Sign in to access your secure workspace' : 'Create an account for your secure workspace'}</p>
            </div>

            <form className="login-reference-form" onSubmit={handleSubmit}>
              {mode === 'register' && <div className="login-reference-field"><label htmlFor="name">Full name</label><div className="login-reference-input-wrap"><span aria-hidden="true">♙</span><input id="name" type="text" placeholder="Enter your full name" value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={120} required /></div></div>}
              <div className="login-reference-field"><label htmlFor="email">Email address</label><div className="login-reference-input-wrap"><span aria-hidden="true">✉</span><input id="email" type="email" placeholder="Email address" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" maxLength={255} required /></div></div>
              <div className="login-reference-field"><label htmlFor="password">Password</label><div className="login-reference-input-wrap"><span aria-hidden="true">♙</span><input id="password" type={showPassword ? 'text' : 'password'} placeholder="Password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 12 : undefined} required /><button className="login-reference-password-toggle" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : '◉'}</button></div></div>

              {mode === 'login' && <div className="login-reference-options"><label><input type="checkbox" /> <span>Remember me</span></label><button type="button" className="login-reference-text-button" onClick={() => setMessage('For password reset, contact your TrustVault administrator.')}>Forgot password?</button></div>}
              {error && <p className="login-reference-message login-reference-error" role="alert">{error}</p>}
              {message && <p className="login-reference-message login-reference-success" role="status">{message}</p>}
              <button className="login-reference-submit" type="submit" disabled={loading}>{loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}{!loading && <span aria-hidden="true">→</span>}</button>
            </form>

            {mode === 'login' && <>
              <div className="login-reference-divider"><span /> <b>OR</b> <span /></div>
              <button type="button" className="login-reference-google" onClick={() => setMessage('Google sign-in is not configured yet. Please use your email and password.')}><span className="google-g" aria-hidden="true">G</span> Continue with Google</button>
              <p className="login-reference-signup">Don't have an account? <button type="button" onClick={() => switchMode('register')}>Sign Up</button></p>
            </>}
            {mode === 'register' && <p className="login-reference-signup">Already have an account? <button type="button" onClick={() => switchMode('login')}>Sign In</button></p>}
          </div>
          <footer className="login-reference-footer"><span>© 2026 TrustVault</span><span>Secure sharing. Clear control.</span></footer>
        </section>
      </section>
    </main>
  )
}

export default App