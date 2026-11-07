import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Inbox,
  Calendar,
  CalendarClock,
  CheckCircle2,
  FolderPlus,
  Activity,
  Search,
  Plus,
  Edit3,
  Trash2,
  Sun,
  Moon,
  Menu,
  X,
  AlertTriangle,
  RefreshCw,
  Check,
  Zap,
  ShieldAlert,
  Server,
  Clock,
  Sparkles,
} from 'lucide-react';

const defaultApiBase =
  typeof window !== 'undefined' && window.location.hostname.endsWith('github.io')
    ? 'https://lattech-todo-backend.onrender.com/api'
    : '/api';
const rawApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim() || defaultApiBase;
const API_BASE_URL = rawApiBase.replace(/\/+$/, '');
const API_ROOT = API_BASE_URL.endsWith('/api') ? API_BASE_URL : `${API_BASE_URL}/api`;
const TODOS_ENDPOINT = `${API_ROOT}/todos`;
const LISTS_ENDPOINT = `${API_ROOT}/lists`;

const REQUEST_TIMEOUT_MS = 45000;

const LIST_COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (err.name === 'AbortError') {
        throw new Error('Backend is waking up from Render free-tier sleep. Click Retry to connect.');
      }
      throw err;
    }
  }
}

function isOverdue(dueDateStr, completed) {
  if (!dueDateStr || completed) return false;
  const todayStr = new Date().toISOString().slice(0, 10);
  return dueDateStr < todayStr;
}

function isToday(dueDateStr) {
  if (!dueDateStr) return false;
  const todayStr = new Date().toISOString().slice(0, 10);
  return dueDateStr === todayStr;
}

export default function App() {
  // Theme (Default light per spec)
  const [theme, setTheme] = useState(() => localStorage.getItem('lattech_theme') || 'light');

  // Navigation: 'inbox' | 'today' | 'upcoming' | 'completed' | 'list:<id>' | 'monitor'
  const [activeView, setActiveView] = useState(() =>
    window.location.hash === '#/monitor' || window.location.pathname.endsWith('/monitor')
      ? 'monitor'
      : 'inbox'
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Data state
  const [todos, setTodos] = useState([]);
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filter / Search / Sort
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [statusChip, setStatusChip] = useState('ALL'); // ALL | ACTIVE | COMPLETED
  const [priorityChip, setPriorityChip] = useState('ALL'); // ALL | HIGH | MEDIUM | LOW

  // Quick Add
  const [quickTitle, setQuickTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Task Modal (Full Add / Edit)
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPriority, setFormPriority] = useState('MEDIUM');
  const [formDueDate, setFormDueDate] = useState('');
  const [formListId, setFormListId] = useState('');

  // List Modal (+ New List)
  const [listModalOpen, setListModalOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListColor, setNewListColor] = useState(LIST_COLORS[0]);

  // Toast notifications
  const [toasts, setToasts] = useState([]);

  // Telemetry state for /monitor page and subtle footer badge
  const [telemetry, setTelemetry] = useState({
    servedBy: 'connecting...',
    rateLimitRemaining: '20',
    lastStatus: null,
    latencyMs: null,
    replicaCounts: {
      'backend-1': 0,
      'backend-2': 0,
      'backend-3': 0,
    },
    history: [],
  });
  const [simulatingLoad, setSimulatingLoad] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('lattech_theme', theme);
  }, [theme]);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const recordTelemetry = useCallback((response, elapsedMs, data) => {
    const rawServedBy =
      response.headers.get('X-Served-By') || data?.servedBy || 'lattech-nginx';
    const remaining = response.headers.get('X-Rate-Limit-Remaining');

    // Normalize replica bucket key for the bar chart
    let bucketKey = rawServedBy;
    if (rawServedBy.includes('backend-1')) bucketKey = 'backend-1';
    else if (rawServedBy.includes('backend-2')) bucketKey = 'backend-2';
    else if (rawServedBy.includes('backend-3')) bucketKey = 'backend-3';

    setTelemetry((prev) => ({
      servedBy: rawServedBy,
      rateLimitRemaining: remaining !== null ? remaining : prev.rateLimitRemaining,
      lastStatus: response.status,
      latencyMs: elapsedMs,
      replicaCounts: {
        ...prev.replicaCounts,
        [bucketKey]: (prev.replicaCounts[bucketKey] || 0) + 1,
      },
      history: [
        {
          time: new Date().toLocaleTimeString(),
          instance: rawServedBy,
          status: response.status,
          latency: elapsedMs,
        },
        ...prev.history.slice(0, 11),
      ],
    }));
  }, []);

  const loadWorkspaceData = useCallback(async (showSkeleton = true) => {
    if (showSkeleton) setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const [todosRes, listsRes] = await Promise.all([
        fetchWithTimeout(TODOS_ENDPOINT),
        fetchWithTimeout(LISTS_ENDPOINT).catch(() => null),
      ]);
      const elapsed = Math.round(performance.now() - start);
      const todosData = await todosRes.json().catch(() => null);
      recordTelemetry(todosRes, elapsed, todosData);

      if (!todosRes.ok) {
        throw new Error(
          todosData?.message || `Server responded with HTTP ${todosRes.status}`
        );
      }
      setTodos(Array.isArray(todosData) ? todosData : []);

      if (listsRes && listsRes.ok) {
        const listsData = await listsRes.json().catch(() => []);
        if (Array.isArray(listsData)) {
          setLists(listsData);
        }
      }
    } catch (err) {
      setError(err.message || 'Unable to reach Lattech Todo backend.');
    } finally {
      setLoading(false);
    }
  }, [recordTelemetry]);

  useEffect(() => {
    loadWorkspaceData(true);
  }, [loadWorkspaceData]);

  const navigateView = (view) => {
    setActiveView(view);
    setSidebarOpen(false);
    if (view === 'monitor') {
      window.history.replaceState(null, '', '#/monitor');
    } else {
      window.history.replaceState(null, '', '#/');
    }
  };

  // Create via Quick Add Bar
  const handleQuickAdd = async (e) => {
    e.preventDefault();
    if (!quickTitle.trim() || submitting) return;
    setSubmitting(true);

    const activeListId = activeView.startsWith('list:')
      ? Number(activeView.split(':')[1])
      : null;
    const defaultDueDate =
      activeView === 'today' ? new Date().toISOString().slice(0, 10) : null;

    const start = performance.now();
    try {
      const res = await fetchWithTimeout(TODOS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: quickTitle.trim(),
          description: '',
          completed: false,
          priority: priorityChip !== 'ALL' ? priorityChip : 'MEDIUM',
          dueDate: defaultDueDate,
          listId: activeListId,
        }),
      });
      const elapsed = Math.round(performance.now() - start);
      const data = await res.json().catch(() => null);
      recordTelemetry(res, elapsed, data);

      if (!res.ok) {
        throw new Error(data?.message || `Failed to create task (HTTP ${res.status})`);
      }

      setTodos((prev) => [data, ...prev]);
      setQuickTitle('');
      addToast('Task added to workspace');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openCreateModal = () => {
    setEditingTodo(null);
    setFormTitle(quickTitle);
    setFormDesc('');
    setFormPriority('MEDIUM');
    setFormDueDate(activeView === 'today' ? new Date().toISOString().slice(0, 10) : '');
    setFormListId(activeView.startsWith('list:') ? activeView.split(':')[1] : '');
    setTaskModalOpen(true);
  };

  const openEditModal = (todo) => {
    setEditingTodo(todo);
    setFormTitle(todo.title || '');
    setFormDesc(todo.description || '');
    setFormPriority(todo.priority || 'MEDIUM');
    setFormDueDate(todo.dueDate || '');
    setFormListId(todo.listId ? String(todo.listId) : '');
    setTaskModalOpen(true);
  };

  const handleSaveTaskModal = async (e) => {
    e.preventDefault();
    if (!formTitle.trim() || submitting) return;
    setSubmitting(true);

    const payload = {
      title: formTitle.trim(),
      description: formDesc.trim(),
      completed: editingTodo ? editingTodo.completed : false,
      priority: formPriority || 'MEDIUM',
      dueDate: formDueDate || null,
      listId: formListId ? Number(formListId) : null,
    };

    const url = editingTodo ? `${TODOS_ENDPOINT}/${editingTodo.id}` : TODOS_ENDPOINT;
    const method = editingTodo ? 'PUT' : 'POST';
    const start = performance.now();

    try {
      const res = await fetchWithTimeout(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const elapsed = Math.round(performance.now() - start);
      const data = await res.json().catch(() => null);
      recordTelemetry(res, elapsed, data);

      if (!res.ok) {
        throw new Error(data?.message || `Failed to save task (HTTP ${res.status})`);
      }

      if (editingTodo) {
        setTodos((prev) => prev.map((t) => (t.id === editingTodo.id ? data : t)));
        addToast('Task updated');
      } else {
        setTodos((prev) => [data, ...prev]);
        setQuickTitle('');
        addToast('Task created');
      }
      setTaskModalOpen(false);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleTodo = async (todo) => {
    const start = performance.now();
    try {
      const res = await fetchWithTimeout(`${TODOS_ENDPOINT}/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: todo.title,
          description: todo.description,
          completed: !todo.completed,
          priority: todo.priority || 'MEDIUM',
          dueDate: todo.dueDate || null,
          listId: todo.listId || null,
        }),
      });
      const elapsed = Math.round(performance.now() - start);
      const data = await res.json().catch(() => null);
      recordTelemetry(res, elapsed, data);

      if (!res.ok) {
        throw new Error(data?.message || `Update failed (HTTP ${res.status})`);
      }
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? data : t)));
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleDeleteTodo = async (id) => {
    const start = performance.now();
    try {
      const res = await fetchWithTimeout(`${TODOS_ENDPOINT}/${id}`, {
        method: 'DELETE',
      });
      const elapsed = Math.round(performance.now() - start);
      let data = null;
      if (res.status !== 204) {
        data = await res.json().catch(() => null);
      }
      recordTelemetry(res, elapsed, data);

      if (!res.ok) {
        throw new Error(data?.message || `Delete failed (HTTP ${res.status})`);
      }
      setTodos((prev) => prev.filter((t) => t.id !== id));
      addToast('Task deleted');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleCreateList = async (e) => {
    e.preventDefault();
    if (!newListName.trim()) return;
    const start = performance.now();
    try {
      const res = await fetchWithTimeout(LISTS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newListName.trim(),
          color: newListColor,
        }),
      });
      const elapsed = Math.round(performance.now() - start);
      const data = await res.json().catch(() => null);
      recordTelemetry(res, elapsed, data);

      if (!res.ok) {
        throw new Error(data?.message || `Could not create list (HTTP ${res.status})`);
      }
      setLists((prev) => [...prev, data]);
      setNewListName('');
      setListModalOpen(false);
      navigateView(`list:${data.id}`);
      addToast(`List "${data.name}" created`);
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  // Traffic Monitor Demo Actions (/monitor)
  const handleSend20TestRequests = async () => {
    if (simulatingLoad) return;
    setSimulatingLoad(true);
    addToast('Sending 20 read requests across Nginx least_conn upstream...');
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      try {
        const res = await fetchWithTimeout(TODOS_ENDPOINT);
        const elapsed = Math.round(performance.now() - start);
        const data = await res.json().catch(() => null);
        recordTelemetry(res, elapsed, data);
      } catch (err) {
        // continue
      }
    }
    setSimulatingLoad(false);
    addToast('Completed 20 load-balanced requests!');
  };

  const handleSpamWrites429 = async () => {
    if (simulatingLoad) return;
    setSimulatingLoad(true);
    addToast('Bursting write requests to trigger Bucket4j HTTP 429...');
    let hit429 = false;
    for (let i = 1; i <= 22; i++) {
      const start = performance.now();
      try {
        const res = await fetchWithTimeout(TODOS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `Rate-Limit Probe #${i}`,
            description: 'Automated Bucket4j write quota test',
            priority: 'LOW',
            completed: true,
          }),
        });
        const elapsed = Math.round(performance.now() - start);
        const data = await res.json().catch(() => null);
        recordTelemetry(res, elapsed, data);

        if (res.status === 429) {
          hit429 = true;
          const retryAfter = res.headers.get('Retry-After') || data?.retryAfterSeconds || 5;
          addToast(
            `HTTP 429 Too Many Requests triggered on write #${i}! (Retry-After: ${retryAfter}s)`,
            'error'
          );
          break;
        } else if (res.ok && data) {
          setTodos((prev) => [data, ...prev]);
        }
      } catch (err) {
        break;
      }
    }
    if (!hit429) {
      addToast('Burst sent! Click again to exhaust remaining write tokens.', 'success');
    }
    setSimulatingLoad(false);
  };

  // Filtered and sorted todos for current view
  const filteredTodos = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);

    return todos
      .filter((todo) => {
        // Sidebar view filter
        if (activeView === 'today') {
          if (todo.completed || todo.dueDate !== todayStr) return false;
        } else if (activeView === 'upcoming') {
          if (todo.completed || !todo.dueDate || todo.dueDate <= todayStr) return false;
        } else if (activeView === 'completed') {
          if (!todo.completed) return false;
        } else if (activeView.startsWith('list:')) {
          const targetListId = Number(activeView.split(':')[1]);
          if (todo.listId !== targetListId) return false;
        }

        // Status chip filter
        if (statusChip === 'ACTIVE' && todo.completed) return false;
        if (statusChip === 'COMPLETED' && !todo.completed) return false;

        // Priority chip filter
        const todoPrio = todo.priority || 'MEDIUM';
        if (priorityChip !== 'ALL' && todoPrio !== priorityChip) return false;

        // Search bar filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchTitle = (todo.title || '').toLowerCase().includes(q);
          const matchDesc = (todo.description || '').toLowerCase().includes(q);
          const matchList = (todo.listName || '').toLowerCase().includes(q);
          if (!matchTitle && !matchDesc && !matchList) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'dueDate') {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        }
        if (sortBy === 'priority') {
          const rank = { HIGH: 1, MEDIUM: 2, LOW: 3 };
          return (rank[a.priority || 'MEDIUM'] || 2) - (rank[b.priority || 'MEDIUM'] || 2);
        }
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });
  }, [todos, activeView, statusChip, priorityChip, searchQuery, sortBy]);

  // Sidebar counts
  const counts = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return {
      inbox: todos.filter((t) => !t.completed).length,
      today: todos.filter((t) => !t.completed && t.dueDate === todayStr).length,
      upcoming: todos.filter((t) => !t.completed && t.dueDate && t.dueDate > todayStr).length,
      completed: todos.filter((t) => t.completed).length,
      byList: todos.reduce((acc, t) => {
        if (t.listId && !t.completed) {
          acc[t.listId] = (acc[t.listId] || 0) + 1;
        }
        return acc;
      }, {}),
    };
  }, [todos]);

  const currentViewMeta = useMemo(() => {
    if (activeView === 'monitor') {
      return { title: 'Traffic Monitor & HA Telemetry', color: null };
    }
    if (activeView === 'today') return { title: 'Today', color: null };
    if (activeView === 'upcoming') return { title: 'Upcoming', color: null };
    if (activeView === 'completed') return { title: 'Completed', color: null };
    if (activeView.startsWith('list:')) {
      const id = Number(activeView.split(':')[1]);
      const found = lists.find((l) => l.id === id);
      return { title: found ? found.name : 'List', color: found?.color };
    }
    return { title: 'Inbox', color: null };
  }, [activeView, lists]);

  const maxReplicaHits = Math.max(
    1,
    ...Object.values(telemetry.replicaCounts)
  );

  return (
    <div className="app-shell">
      {/* Left Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-left">
            <div className="brand-logo">LT</div>
            <div>
              <span className="brand-title">Lattech Todo</span>
              <span className="brand-subtitle">Enterprise Workspace</span>
            </div>
          </div>
          <button
            className="mobile-menu-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeView === 'inbox' ? 'active' : ''}`}
            onClick={() => navigateView('inbox')}
          >
            <span className="nav-item-left">
              <Inbox size={17} />
              <span className="nav-item-label">Inbox</span>
            </span>
            <span className="nav-count">{counts.inbox}</span>
          </button>

          <button
            className={`nav-item ${activeView === 'today' ? 'active' : ''}`}
            onClick={() => navigateView('today')}
          >
            <span className="nav-item-left">
              <Calendar size={17} />
              <span className="nav-item-label">Today</span>
            </span>
            <span className="nav-count">{counts.today}</span>
          </button>

          <button
            className={`nav-item ${activeView === 'upcoming' ? 'active' : ''}`}
            onClick={() => navigateView('upcoming')}
          >
            <span className="nav-item-left">
              <CalendarClock size={17} />
              <span className="nav-item-label">Upcoming</span>
            </span>
            <span className="nav-count">{counts.upcoming}</span>
          </button>

          <button
            className={`nav-item ${activeView === 'completed' ? 'active' : ''}`}
            onClick={() => navigateView('completed')}
          >
            <span className="nav-item-left">
              <CheckCircle2 size={17} />
              <span className="nav-item-label">Completed</span>
            </span>
            <span className="nav-count">{counts.completed}</span>
          </button>
        </nav>

        <div className="sidebar-section-header">
          <span>Lists</span>
        </div>

        <div className="sidebar-nav">
          {lists.map((list) => {
            const viewKey = `list:${list.id}`;
            const count = counts.byList[list.id] ?? 0;
            return (
              <button
                key={list.id}
                className={`nav-item ${activeView === viewKey ? 'active' : ''}`}
                onClick={() => navigateView(viewKey)}
              >
                <span className="nav-item-left">
                  <span
                    className="color-dot"
                    style={{ backgroundColor: list.color || '#6366f1' }}
                  />
                  <span className="nav-item-label">{list.name}</span>
                </span>
                <span className="nav-count">{count}</span>
              </button>
            );
          })}

          <button
            className="nav-item new-list-btn"
            onClick={() => setListModalOpen(true)}
          >
            <span className="nav-item-left">
              <FolderPlus size={17} />
              <span>+ New List</span>
            </span>
          </button>
        </div>

        <div className="sidebar-footer">
          <button
            className={`nav-item monitor-link ${activeView === 'monitor' ? 'active' : ''}`}
            onClick={() => navigateView('monitor')}
          >
            <span className="nav-item-left">
              <Activity size={17} />
              <span>Traffic Monitor</span>
            </span>
            <span className="nav-count">/monitor</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="main-area">
        {/* Top Header */}
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
            <h1 className="view-title">
              {currentViewMeta.color && (
                <span
                  className="color-dot"
                  style={{
                    backgroundColor: currentViewMeta.color,
                    width: 12,
                    height: 12,
                  }}
                />
              )}
              {currentViewMeta.title}
            </h1>
          </div>

          <div className="topbar-controls">
            {activeView !== 'monitor' && (
              <>
                <div className="search-box">
                  <Search size={15} className="search-icon" />
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Search tasks..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <select
                  className="select-input"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label="Sort tasks"
                >
                  <option value="createdAt">Sort: Newest</option>
                  <option value="dueDate">Sort: Due Date</option>
                  <option value="priority">Sort: Priority</option>
                </select>

                <button className="btn-primary" onClick={openCreateModal}>
                  <Plus size={16} />
                  <span>New Task</span>
                </button>
              </>
            )}

            <button
              className="icon-btn"
              onClick={() => loadWorkspaceData(false)}
              title="Sync with backend"
            >
              <RefreshCw size={15} />
              <span>Sync</span>
            </button>

            <button
              className="icon-btn"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              title="Toggle Light/Dark theme"
            >
              {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
            </button>
          </div>
        </header>

        {/* Body Content */}
        <main className="content-container">
          {error && (
            <div className="error-banner">
              <div className="error-banner-left">
                <AlertTriangle size={18} />
                <span>{error}</span>
              </div>
              <button
                className="btn-primary"
                onClick={() => loadWorkspaceData(true)}
              >
                <RefreshCw size={14} />
                <span>Retry</span>
              </button>
            </div>
          )}

          {activeView === 'monitor' ? (
            /* Dedicated Traffic Monitor Page (/monitor) */
            <div>
              <div className="monitor-header-banner">
                <div>
                  <h2 style={{ fontSize: '1.05rem', fontWeight: 700 }}>
                    Live Infrastructure & Traffic Management Demo
                  </h2>
                  <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                    Test Nginx <code>least_conn</code> load balancing across 3 Spring Boot replicas and trigger Bucket4j <code>HTTP 429</code> rate limiting.
                  </p>
                </div>
                <div className="monitor-actions">
                  <button
                    className="btn-primary"
                    onClick={handleSend20TestRequests}
                    disabled={simulatingLoad}
                  >
                    <Zap size={15} />
                    <span>
                      {simulatingLoad ? 'Running...' : 'Send 20 test requests'}
                    </span>
                  </button>
                  <button
                    className="icon-btn"
                    style={{
                      borderColor: 'var(--danger)',
                      color: 'var(--danger)',
                      fontWeight: 600,
                    }}
                    onClick={handleSpamWrites429}
                    disabled={simulatingLoad}
                  >
                    <ShieldAlert size={15} />
                    <span>Spam writes (Trigger 429)</span>
                  </button>
                </div>
              </div>

              <div className="monitor-grid">
                <div className="monitor-card">
                  <span className="monitor-card-label">
                    Last X-Served-By Replica
                  </span>
                  <span className="monitor-card-value">{telemetry.servedBy}</span>
                  <p className="monitor-card-explain">
                    Injected by <code>InstanceHeaderFilter</code> on each Spring Boot instance to prove upstream routing.
                  </p>
                </div>

                <div className="monitor-card">
                  <span className="monitor-card-label">
                    Write Quota Remaining
                  </span>
                  <span className="monitor-card-value">
                    {telemetry.rateLimitRemaining} / 20 req/min
                  </span>
                  <p className="monitor-card-explain">
                    Enforced per client IP via Bucket4j token bucket on <code>POST/PUT/DELETE</code> endpoints.
                  </p>
                </div>

                <div className="monitor-card">
                  <span className="monitor-card-label">
                    Last Status & Latency
                  </span>
                  <span
                    className="monitor-card-value"
                    style={{
                      color:
                        telemetry.lastStatus === 429
                          ? 'var(--danger)'
                          : 'var(--success)',
                    }}
                  >
                    {telemetry.lastStatus
                      ? `HTTP ${telemetry.lastStatus} (${telemetry.latencyMs}ms)`
                      : '—'}
                  </span>
                  <p className="monitor-card-explain">
                    Guarded by Resilience4j CircuitBreaker + 8s TimeLimiter to prevent database cascading failures.
                  </p>
                </div>
              </div>

              {/* Bar chart of requests per replica */}
              <div className="bar-chart-card">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>
                    Requests Served per Backend Replica (Live Distribution)
                  </h3>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Upstream: <code>todo_backend_cluster (least_conn)</code>
                  </span>
                </div>

                {Object.entries(telemetry.replicaCounts).map(([replica, count]) => {
                  const pct = Math.round((count / maxReplicaHits) * 100);
                  return (
                    <div key={replica} className="bar-row">
                      <span className="bar-label">{replica}</span>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{ width: `${count > 0 ? Math.max(pct, 6) : 0}%` }}
                        />
                      </div>
                      <span className="bar-count">{count} reqs</span>
                    </div>
                  );
                })}
                <p className="monitor-card-explain" style={{ marginTop: 14 }}>
                  Click <strong>Send 20 test requests</strong> above to watch Nginx distribute traffic evenly across <code>backend-1</code>, <code>backend-2</code>, and <code>backend-3</code>.
                </p>
              </div>
            </div>
          ) : (
            /* Main Todo Workspace View */
            <>
              {/* Filter Chips */}
              <div className="filter-bar">
                <div className="chip-group">
                  {['ALL', 'ACTIVE', 'COMPLETED'].map((status) => (
                    <button
                      key={status}
                      className={`filter-chip ${statusChip === status ? 'active' : ''}`}
                      onClick={() => setStatusChip(status)}
                    >
                      {status === 'ALL'
                        ? 'All Tasks'
                        : status === 'ACTIVE'
                        ? 'Active'
                        : 'Completed'}
                    </button>
                  ))}
                </div>

                <div className="chip-group">
                  {['ALL', 'HIGH', 'MEDIUM', 'LOW'].map((prio) => (
                    <button
                      key={prio}
                      className={`filter-chip ${priorityChip === prio ? 'active' : ''}`}
                      onClick={() => setPriorityChip(prio)}
                    >
                      {prio === 'ALL' ? 'Any Priority' : prio}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick-Add Bar */}
              <form className="quick-add-bar" onSubmit={handleQuickAdd}>
                <Plus size={18} color="var(--primary)" />
                <input
                  type="text"
                  className="quick-add-input"
                  placeholder="Quick add a task... (Press Enter to save, or click 'New Task' for details)"
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value)}
                  maxLength={255}
                />
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!quickTitle.trim() || submitting}
                >
                  Add
                </button>
              </form>

              {/* Task List or Skeletons or Empty State */}
              {loading ? (
                <div className="task-list">
                  <div className="skeleton-card" />
                  <div className="skeleton-card" />
                  <div className="skeleton-card" />
                </div>
              ) : filteredTodos.length === 0 ? (
                <div className="empty-state-box">
                  <div className="empty-icon-wrap">
                    <Sparkles size={24} />
                  </div>
                  <div className="empty-title">
                    No tasks in {currentViewMeta.title}
                  </div>
                  <p className="empty-desc">
                    Use the quick-add bar above or click <strong>New Task</strong> to schedule work with priorities, due dates, and folders.
                  </p>
                </div>
              ) : (
                <div className="task-list">
                  {filteredTodos.map((todo) => {
                    const overdue = isOverdue(todo.dueDate, todo.completed);
                    const dueToday = isToday(todo.dueDate);
                    const prio = todo.priority || 'MEDIUM';

                    return (
                      <div
                        key={todo.id}
                        className={`task-card ${todo.completed ? 'completed' : ''}`}
                      >
                        <div className="task-left">
                          <button
                            type="button"
                            className={`task-checkbox ${todo.completed ? 'checked' : ''}`}
                            onClick={() => handleToggleTodo(todo)}
                            aria-label="Toggle task completion"
                          >
                            {todo.completed && <Check size={12} strokeWidth={3} />}
                          </button>

                          <div className="task-body">
                            <div className="task-title">{todo.title}</div>
                            {todo.description && (
                              <div className="task-desc">{todo.description}</div>
                            )}

                            <div className="task-meta">
                              <span className={`badge priority-${prio}`}>
                                {prio}
                              </span>

                              {todo.dueDate && (
                                <span
                                  className={`badge due-chip ${overdue ? 'overdue' : ''}`}
                                >
                                  <Clock size={11} />
                                  <span>
                                    {overdue
                                      ? `Overdue • ${todo.dueDate}`
                                      : dueToday
                                      ? 'Due Today'
                                      : todo.dueDate}
                                  </span>
                                </span>
                              )}

                              {todo.listName && (
                                <span className="badge list-chip">
                                  <span
                                    className="color-dot"
                                    style={{
                                      backgroundColor:
                                        todo.listColor || 'var(--primary)',
                                      width: 7,
                                      height: 7,
                                    }}
                                  />
                                  <span>{todo.listName}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="task-actions">
                          <button
                            type="button"
                            className="action-icon-btn"
                            onClick={() => openEditModal(todo)}
                            title="Edit task"
                          >
                            <Edit3 size={15} />
                          </button>
                          <button
                            type="button"
                            className="action-icon-btn danger"
                            onClick={() => handleDeleteTodo(todo.id)}
                            title="Delete task"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </main>

        {/* Subtle Footer with Served-by Badge */}
        <footer className="app-footer">
          <span>
            Built by <strong style={{ color: 'var(--primary)' }}>Lattech</strong>
          </span>
          <span className="served-by-pill">
            <Server
              size={11}
              style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }}
            />
            Served by: {telemetry.servedBy}
          </span>
        </footer>
      </div>

      {/* Full Task Add / Edit Modal */}
      {taskModalOpen && (
        <div className="modal-backdrop" onClick={() => setTaskModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {editingTodo ? 'Edit Task' : 'New Task'}
              </span>
              <button
                className="action-icon-btn"
                onClick={() => setTaskModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveTaskModal}>
              <div className="form-group">
                <label className="form-label">Title</label>
                <input
                  type="text"
                  className="form-input"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g., Review Nginx rate-limit burst parameters"
                  required
                  maxLength={255}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-textarea"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Optional notes, context, or acceptance criteria..."
                  maxLength={1000}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select
                    className="form-select"
                    value={formPriority}
                    onChange={(e) => setFormPriority(e.target.value)}
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Due Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">List / Folder</label>
                <select
                  className="form-select"
                  value={formListId}
                  onChange={(e) => setFormListId(e.target.value)}
                >
                  <option value="">No List (Inbox)</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setTaskModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={submitting}
                >
                  {editingTodo ? 'Save Changes' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New List Modal */}
      {listModalOpen && (
        <div className="modal-backdrop" onClick={() => setListModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Create New List</span>
              <button
                className="action-icon-btn"
                onClick={() => setListModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateList}>
              <div className="form-group">
                <label className="form-label">List Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="e.g., Q4 Engineering Roadmap"
                  required
                  maxLength={100}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">Folder Color</label>
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  {LIST_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewListColor(c)}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        backgroundColor: c,
                        border:
                          newListColor === c
                            ? '3px solid var(--text-primary)'
                            : '2px solid transparent',
                        cursor: 'pointer',
                      }}
                      aria-label={`Select color ${c}`}
                    />
                  ))}
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setListModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Create List
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Stack */}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
