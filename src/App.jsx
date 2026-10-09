import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useMemo, useState } from 'react';

async function fetchJson(path, options = {}) {
  const { body, ...requestOptions } = options;
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  if (body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await axios.request({
      url: `/api/v1${path}`,
      ...requestOptions,
      data: body,
      headers,
    });

    if (response.status === 204) {
      return null;
    }

    const payload = response.data;
    if (Array.isArray(payload?.data)) {
      return payload;
    }

    return payload.data ?? payload;
  } catch (error) {
    throw new Error(error?.response?.data?.error?.message || 'Request failed', { cause: error });
  }
}

function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => fetchJson('/auth/me', { method: 'GET' }),
    retry: false,
    staleTime: 5 * 60 * 1000,
    throwOnError: false,
  });
}

function LoginPanel({ onLoggedIn }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const loginMutation = useMutation({
    mutationFn: (values) =>
      fetchJson('/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
      onLoggedIn();
    },
  });

  return (
    <div className="panel auth-panel">
      <h1>GOSSA owner sign in</h1>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          loginMutation.mutate({ email, password });
        }}
      >
        <label>
          <span>Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          <span>Password</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button type="submit" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {loginMutation.isError ? <p className="error">{loginMutation.error.message}</p> : null}
    </div>
  );
}

function DashboardView() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => fetchJson('/dashboard'),
  });

  if (isLoading) return <p>Loading dashboard…</p>;
  if (isError) return <p className="error">{error.message}</p>;

  const stats = data || {};

  return (
    <div className="panel">
      <h2>Dashboard</h2>
      <div className="stats-grid">
        <div className="stat"><strong>{stats.open_count ?? 0}</strong><span>Open</span></div>
        <div className="stat"><strong>{stats.in_progress_count ?? 0}</strong><span>In progress</span></div>
        <div className="stat"><strong>{stats.waiting_count ?? 0}</strong><span>Waiting</span></div>
        <div className="stat"><strong>{stats.completed_today_count ?? 0}</strong><span>Completed today</span></div>
      </div>

      <div className="list-block">
        <h3>Recent jobs</h3>
        {stats.recent_jobs?.length ? (
          <ul className="list">
            {stats.recent_jobs.map((job) => (
              <li key={job.id} className="list-item">
                <div>
                  <strong>{job.job_number}</strong> · {job.customer_name}
                </div>
                <span>{job.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No recent jobs.</p>
        )}
      </div>
    </div>
  );
}

function MechanicsView({ csrfToken }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['mechanics'],
    queryFn: () => fetchJson('/mechanics'),
  });

  const createMutation = useMutation({
    mutationFn: (values) =>
      fetchJson('/mechanics', {
        method: 'POST',
        body: JSON.stringify(values),
        headers: {
          'X-CSRF-Token': csrfToken,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mechanics'] });
    },
  });

  const [form, setForm] = useState({ name: 'Alex Mechanic', phone: '+254700000000', skills: 'Diagnostics' });

  if (isLoading) return <p>Loading mechanics…</p>;
  if (isError) return <p className="error">{error.message}</p>;

  return (
    <div className="panel">
      <h2>Mechanics</h2>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate(form);
        }}
      >
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Name" />
        <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Phone" />
        <input value={form.skills} onChange={(event) => setForm({ ...form, skills: event.target.value })} placeholder="Skills" />
        <button type="submit" disabled={createMutation.isPending}>Add mechanic</button>
      </form>

      <ul className="list">
        {(data?.data || []).map((mechanic) => (
          <li key={mechanic.id} className="list-item">
            <div>
              <strong>{mechanic.name}</strong>
              <span>{mechanic.phone || 'No phone provided'}</span>
            </div>
            <small>{mechanic.duty_status}</small>
          </li>
        ))}
      </ul>
      {createMutation.isError ? <p className="error" role="alert">{createMutation.error.message}</p> : null}
    </div>
  );
}

function JobsView({ csrfToken }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => fetchJson('/jobs'),
  });

  const createMutation = useMutation({
    mutationFn: (values) =>
      fetchJson('/jobs', {
        method: 'POST',
        body: JSON.stringify(values),
        headers: {
          'X-CSRF-Token': csrfToken,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const [form, setForm] = useState({
    customer_name: 'Sam Example',
    vehicle_registration: 'KDA 123A',
    work_requested: 'Inspect front brakes',
  });

  if (isLoading) return <p>Loading jobs…</p>;
  if (isError) return <p className="error">{error.message}</p>;

  return (
    <div className="panel">
      <h2>Jobs</h2>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate(form);
        }}
      >
        <div className="field-row">
          <input value={form.customer_name} onChange={(event) => setForm({ ...form, customer_name: event.target.value })} placeholder="Customer name" />
          <input value={form.vehicle_registration} onChange={(event) => setForm({ ...form, vehicle_registration: event.target.value })} placeholder="Vehicle registration" />
        </div>
        <textarea value={form.work_requested} onChange={(event) => setForm({ ...form, work_requested: event.target.value })} placeholder="Work requested" rows={4} />
        <button type="submit" disabled={createMutation.isPending}>Create job</button>
      </form>

      <ul className="list">
        {(data?.data || []).map((job) => (
          <li key={job.id} className="list-item">
            <div>
              <strong>{job.job_number}</strong> · {job.customer_name}
            </div>
            <span>{job.status}</span>
          </li>
        ))}
      </ul>
      {createMutation.isError ? <p className="error" role="alert">{createMutation.error.message}</p> : null}
    </div>
  );
}

function AppShell() {
  const sessionQuery = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('dashboard');

  const session = useMemo(() => sessionQuery.data, [sessionQuery.data]);
  const logoutMutation = useMutation({
    mutationFn: () => fetchJson('/auth/logout', {
      method: 'POST',
      headers: {
        'X-CSRF-Token': session?.csrf_token || '',
      },
    }),
    onSuccess: () => {
      queryClient.clear();
      sessionQuery.refetch();
    },
  });

  if (sessionQuery.isLoading) {
    return <div className="page-shell"><p>Checking session…</p></div>;
  }

  if (sessionQuery.isError) {
    return <LoginPanel onLoggedIn={() => sessionQuery.refetch()} />;
  }

  return (
    <div className="page-shell">
      <header className="topbar">
        <div>
          <strong>{session?.garage?.name || 'GOSSA'}</strong>
          <small>{session?.user?.name}</small>
        </div>
        <nav className="tabs">
          {['dashboard', 'mechanics', 'jobs'].map((item) => (
            <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </nav>
        <button className="ghost" onClick={() => logoutMutation.mutate()}>Log out</button>
      </header>
      {logoutMutation.isError ? <p className="error" role="alert">{logoutMutation.error.message}</p> : null}

      {tab === 'dashboard' ? <DashboardView /> : null}
      {tab === 'mechanics' ? <MechanicsView csrfToken={session?.csrf_token} /> : null}
      {tab === 'jobs' ? <JobsView csrfToken={session?.csrf_token} /> : null}
    </div>
  );
}

function App() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}

export default App;
