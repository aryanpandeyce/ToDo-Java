import React, { useState, useEffect, useCallback } from 'react';

const defaultApiBase =
  typeof window !== 'undefined' && window.location.hostname.endsWith('github.io')
    ? 'https://lattech-todo-backend.onrender.com/api'
    : '/api';
const rawApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim() || defaultApiBase;
const API_BASE_URL = rawApiBase.replace(/\/+$/, '');
const TODOS_ENDPOINT = API_BASE_URL.endsWith('/api')
  ? `${API_BASE_URL}/todos`
  : `${API_BASE_URL}/api/todos`;

export default function App() {
  const [todos, setTodos] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Telemetry state to showcase Traffic Management in UI
  const [telemetry, setTelemetry] = useState({
    servedBy: 'Waiting for request...',
    rateLimitRemaining: 'N/A',
    lastStatus: null,
    latencyMs: null,
    replicaHistory: []
  });

  const recordTelemetry = (response, elapsedMs, data) => {
    const servedBy = response.headers.get('X-Served-By') || data?.servedBy || 'lattech-nginx-gateway';
    const remaining = response.headers.get('X-Rate-Limit-Remaining');
    const retryAfter = response.headers.get('Retry-After');

    setTelemetry((prev) => ({
      servedBy,
      rateLimitRemaining: remaining !== null ? remaining : prev.rateLimitRemaining,
      retryAfter,
      lastStatus: response.status,
      latencyMs: elapsedMs,
      replicaHistory: [
        {
          time: new Date().toLocaleTimeString(),
          instance: servedBy,
          status: response.status,
          latency: elapsedMs
        },
        ...prev.replicaHistory.slice(0, 7)
      ]
    }));
  };

  const fetchTodos = useCallback(async () => {
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const res = await fetch(TODOS_ENDPOINT);
      const elapsed = Math.round(performance.now() - start);
      const data = await res.json().catch(() => null);
      recordTelemetry(res, elapsed, data);

      if (!res.ok) {
        throw new Error(data?.message || `HTTP ${res.status}: ${res.statusText}`);
      }
      setTodos(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const handleAddTodo = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    const start = performance.now();
    try {
      const res = await fetch(TODOS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, completed: false })
      });
      const elapsed = Math.round(performance.now() - start);
      const data = await res.json().catch(() => null);
      recordTelemetry(res, elapsed, data);

      if (!res.ok) {
        throw new Error(data?.message || `Rate limited or failed (HTTP ${res.status})`);
      }
      setTodos((prev) => [data, ...prev]);
      setTitle('');
      setDescription('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleComplete = async (todo) => {
    setError(null);
    const start = performance.now();
    try {
      const res = await fetch(`${TODOS_ENDPOINT}/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: todo.title,
          description: todo.description,
          completed: !todo.completed
        })
      });
      const elapsed = Math.round(performance.now() - start);
      const data = await res.json().catch(() => null);
      recordTelemetry(res, elapsed, data);

      if (!res.ok) {
        throw new Error(data?.message || `Update failed (HTTP ${res.status})`);
      }
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? data : t)));
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (todo) => {
    setEditingId(todo.id);
    setEditTitle(todo.title);
    setEditDescription(todo.description || '');
  };

  const handleSaveEdit = async (todo) => {
    if (!editTitle.trim()) return;
    setError(null);
    const start = performance.now();
    try {
      const res = await fetch(`${TODOS_ENDPOINT}/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          completed: todo.completed
        })
      });
      const elapsed = Math.round(performance.now() - start);
      const data = await res.json().catch(() => null);
      recordTelemetry(res, elapsed, data);

      if (!res.ok) {
        throw new Error(data?.message || `Update failed (HTTP ${res.status})`);
      }
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? data : t)));
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    setError(null);
    const start = performance.now();
    try {
      const res = await fetch(`${TODOS_ENDPOINT}/${ id}`, { method: 'DELETE' });
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
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="container">
      <header className="header">
        <div className="brand-header">
          <div className="brand-logo">LT</div>
          <div>
            <h1>Lattech Todo</h1>
            <p className="subtitle">
              Enterprise Traffic Management • Nginx (least_conn) • 3x Spring Boot Replicas • Bucket4j & Resilience4j
            </p>
          </div>
        </div>
        <button className="btn btn-secondary" onClick={fetchTodos} disabled={loading}>
          {loading ? 'Refreshing...' : 'Ping Upstream (GET)'}
        </button>
      </header>

      {/* Live Infrastructure Telemetry Banner */}
      <section className="telemetry-panel">
        <div className="telemetry-grid">
          <div className="metric-card">
            <span className="metric-label">Last X-Served-By Instance</span>
            <span className="metric-value instance-badge">{telemetry.servedBy}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Write Quota Remaining (Bucket4j)</span>
            <span className="metric-value">{telemetry.rateLimitRemaining} / min</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Last HTTP Status & Latency</span>
            <span className={`metric-value status-${telemetry.lastStatus === 429 ? 'warn' : 'ok'}`}>
              {telemetry.lastStatus ? `HTTP ${telemetry.lastStatus} (${telemetry.latencyMs}ms)` : '—'}
            </span>
          </div>
        </div>

        {telemetry.replicaHistory.length > 0 && (
          <div className="history-strip">
            <span className="history-title">Recent Upstream Routing:</span>
            {telemetry.replicaHistory.map((item, idx) => (
              <span key={idx} className={`history-pill status-code-${item.status}`}>
                {item.instance} ({item.status} • {item.latency}ms)
              </span>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div className="alert-error">
          <strong>Traffic / API Alert:</strong> {error}
          {telemetry.retryAfter && <span> (Retry-After: {telemetry.retryAfter}s)</span>}
        </div>
      )}

      <form className="todo-form" onSubmit={handleAddTodo}>
        <input
          type="text"
          placeholder="What needs to be done?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={255}
        />
        <input
          type="text"
          placeholder="Optional description or notes..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
        />
        <button type="submit" className="btn btn-primary">
          Add Todo (POST)
        </button>
      </form>

      <div className="todo-list">
        {todos.length === 0 ? (
          <p className="empty-state">No todos yet. Create one above to test Lattech upstream load balancing!</p>
        ) : (
          todos.map((todo) => (
            <div key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
              {editingId === todo.id ? (
                <div className="edit-mode">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Description"
                  />
                  <div className="actions">
                    <button className="btn btn-primary btn-sm" onClick={() => handleSaveEdit(todo)}>
                      Save
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="todo-content" onClick={() => handleToggleComplete(todo)}>
                    <input
                      type="checkbox"
                      checked={todo.completed}
                      onChange={() => {}}
                      className="checkbox"
                    />
                    <div>
                      <div className="todo-title">{todo.title}</div>
                      {todo.description && <div className="todo-desc">{todo.description}</div>}
                    </div>
                  </div>
                  <div className="actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => startEdit(todo)}>
                      Edit
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(todo.id)}>
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      <footer className="footer">
        <span>Built by <strong>Lattech</strong></span>
        <span className="footer-sep">•</span>
        <span>High-Availability Traffic Management Architecture</span>
      </footer>
    </div>
  );
}
