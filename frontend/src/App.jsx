
import { useCallback, useEffect, useState } from "react";
import {
  Activity, ArrowUpRight, BookOpen, Check,
  Clock3, Code2, FileText, Flame, FolderOpen,
  LayoutDashboard, LoaderCircle, LogOut, Plus, RefreshCw,
  Search, Target, Trash2, Trophy, UserRound, Users, X,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from "recharts";

const API_URL = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const AUTH_KEY = "studytrack_auth";

function apiFetch(token, path, options = {}) {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

function apiErrorMessage(detail, fallback) {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return fallback;

  return detail.map((issue) => {
    const field = Array.isArray(issue.loc)
      ? issue.loc.filter((part) => part !== "body").join(" ")
      : "Input";
    const message = issue.msg || "is invalid";
    return field ? `${field}: ${message}` : message;
  }).join(". ");
}

const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "sessions", label: "Study sessions", icon: Clock3 },
  { id: "notes", label: "My notes", icon: FileText },
  { id: "topics", label: "Topics", icon: FolderOpen },
  { id: "competition", label: "Competition", icon: Trophy },
];

function formatDuration(seconds = 0) {
  const n = Math.floor(Math.max(0, Number(seconds) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m && s) return `${m}m ${s}s`;
  if (m) return `${m}m`;
  return `${s}s`;
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Date unavailable";
  return d.toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit",
  });
}

function getInitials(value = "StudyTrack") {
  return value.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((word) => word[0].toUpperCase()).join("");
}

function StatCard({ title, value, subtitle, icon: Icon, tone }) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span className={`stat-icon ${tone}`}><Icon size={20} /></span>
        <span className="stat-period">All time</span>
      </div>
      <p className="stat-label">{title}</p>
      <h2 className="stat-value">{value}</h2>
      <p className="stat-subtitle">{subtitle}</p>
    </article>
  );
}

function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={24} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function SearchBox({ value, onChange }) {
  return (
    <div className="search-box">
      <Search size={17} />
      <input value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="Search..." aria-label="Search" />
      {value && (
        <button className="search-clear" onClick={() => onChange("")}
          aria-label="Clear search"><X size={15} /></button>
      )}
    </div>
  );
}

function SessionTable({ sessions, loading }) {
  if (loading && sessions.length === 0) {
    return <div className="table-loading"><LoaderCircle className="spin" size={22} /> Loading sessions...</div>;
  }
  if (sessions.length === 0) {
    return <EmptyState icon={Clock3} title="No study sessions yet"
      description="Your saved sessions will appear here when they're recorded." />;
  }
  return (
    <div className="table-scroll">
      <table className="sessions-table">
        <thead><tr>
          <th>SUBJECT / WEBSITE</th><th>TOPIC</th><th>DATE</th>
          <th>STARTED</th><th>DURATION</th>
        </tr></thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id}>
              <td><div className="session-name-cell">
                <span className="session-icon"><BookOpen size={16} /></span>
                <div><strong>{session.subject || "General"}</strong>
                  <span>{session.site_title || session.site_url || "Study session"}</span>
                </div>
              </div></td>
              <td><span className="table-topic">{session.topic || "General"}</span>
                <span className="session-domain">{session.domain || ""}</span></td>
              <td>{formatDate(session.started_at)}</td>
              <td>{formatTime(session.started_at)}</td>
              <td><strong className="duration-value">{formatDuration(session.duration_seconds)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sessionDomain(session) {
  if (session.domain?.trim()) return session.domain.trim();
  try {
    return session.site_url ? new URL(session.site_url).hostname.replace(/^www\./, "") : "General";
  } catch {
    return "General";
  }
}

function GroupedSessions({ sessions, loading }) {
  if (loading && sessions.length === 0) {
    return <div className="table-loading"><LoaderCircle className="spin" size={22} /> Loading sessions...</div>;
  }
  if (!sessions.length) {
    return <EmptyState icon={Clock3} title="No study sessions yet"
      description="Your saved sessions will appear here when they're recorded." />;
  }

  const grouped = new Map();
  sessions.forEach((session) => {
    const topic = session.topic || session.subject || "General";
    const domain = sessionDomain(session);
    if (!grouped.has(topic)) grouped.set(topic, new Map());
    const domains = grouped.get(topic);
    if (!domains.has(domain)) domains.set(domain, []);
    domains.get(domain).push(session);
  });

  const topicGroups = [...grouped.entries()].map(([topic, domains]) => {
    const domainGroups = [...domains.entries()].map(([domain, items]) => ({
      domain,
      sessions: items.sort((a, b) => new Date(b.started_at) - new Date(a.started_at)),
      seconds: items.reduce((total, item) => total + (Number(item.duration_seconds) || 0), 0),
    })).sort((a, b) => a.domain.localeCompare(b.domain));
    return {
      topic,
      domains: domainGroups,
      count: domainGroups.reduce((total, group) => total + group.sessions.length, 0),
      seconds: domainGroups.reduce((total, group) => total + group.seconds, 0),
    };
  }).sort((a, b) => b.seconds - a.seconds || a.topic.localeCompare(b.topic));

  return <div className="session-topic-list">
    {topicGroups.map((topicGroup) => <details className="session-topic-group" key={topicGroup.topic}>
      <summary>
        <span className="session-topic-title"><BookOpen size={17} />{topicGroup.topic}</span>
        <span className="session-group-meta">{topicGroup.count} sessions</span>
        <strong>{formatDuration(topicGroup.seconds)}</strong>
      </summary>
      <div className="session-domain-list">
        {topicGroup.domains.map((domainGroup) => <details className="session-domain-group" key={domainGroup.domain}>
          <summary>
            <span>{domainGroup.domain}</span>
            <span className="session-group-meta">{domainGroup.sessions.length} sessions</span>
            <strong>{formatDuration(domainGroup.seconds)}</strong>
          </summary>
          <div className="session-entry-list">
            {domainGroup.sessions.map((session) => <article className="session-entry" key={session.id}>
              <div className="session-entry-main">
                <strong>{session.site_title || session.site_url || "Study session"}</strong>
                <span>{formatDate(session.started_at)} · {formatTime(session.started_at)}</span>
              </div>
              <strong className="duration-value">{formatDuration(session.duration_seconds)}</strong>
            </article>)}
          </div>
        </details>)}
      </div>
    </details>)}
  </div>;
}

function AuthWelcome({ onAuthenticate, busy, error }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("login");

  function submit(event) {
    event.preventDefault();
    onAuthenticate({
      mode,
      name: name.trim(),
      email: email.trim(),
      password,
    });
  }

  return (
    <main style={{
      minHeight: "100vh", display: "grid", placeItems: "center",
      padding: 24, background: "var(--background, #f7f6fc)",
    }}>
      <section className="panel" style={{
        width: "100%", maxWidth: 440, padding: 32, boxSizing: "border-box",
      }}>
        <div className="brand" style={{ marginBottom: 28 }}>
          <div className="brand-mark"><BookOpen size={23} /></div>
          <div>
            <span className="brand-name">studytrack</span>
            <span className="brand-caption">YOUR LEARNING SPACE</span>
          </div>
        </div>
        <span className="eyebrow"><span className="eyebrow-dot" /> YOUR LEARNING SPACE</span>
        <h1 style={{ marginTop: 16 }}>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="page-subtitle">
          {mode === "login" ? "Sign in to continue to your study workspace." : "Create an account to save your study progress."}
        </p>
        <form onSubmit={submit} className="modal-form" style={{ marginTop: 24 }}>
          {mode === "register" && <>
            <label htmlFor="auth-name">Your name</label>
            <input id="auth-name" autoFocus required minLength={2} maxLength={80}
              placeholder="e.g. Mayuri" value={name}
              onChange={(e) => setName(e.target.value)} />
            <span className="field-hint">Use 2–80 characters.</span>
          </>}
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" autoFocus={mode === "login"} required type="email"
            autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="auth-password">Password</label>
          <input id="auth-password" required type="password"
            minLength={mode === "register" ? 8 : undefined}
            maxLength={mode === "register" ? 128 : undefined}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === "register" && <span className="field-hint">Use 8–128 characters.</span>}
          {error && <div className="alert alert-error">{error}</div>}
          <button className="primary-button" disabled={busy}
            style={{ width: "100%", justifyContent: "center", marginTop: 12 }}>
            {busy ? <LoaderCircle size={17} className="spin" /> : <UserRound size={17} />}
            {busy ? "Connecting..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button type="button" className="text-button"
          style={{ marginTop: 16 }} disabled={busy}
          onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "New to StudyTrack? Create an account" : "Already registered? Sign in"}
        </button>
      </section>
    </main>
  );
}

export default function App() {
  const [profile, setProfile] = useState(() => {
    try {
      const saved = localStorage.getItem(AUTH_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");

  const [activePage, setActivePage] = useState("overview");
  const [summary, setSummary] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [notes, setNotes] = useState([]);
  const [topics, setTopics] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(() =>
    localStorage.getItem("studytrack_workspace") || ""
  );
  const [leaderboard, setLeaderboard] = useState(null);
  const [winners, setWinners] = useState([]);
  const [roundWinners, setRoundWinners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteReadOnly, setNoteReadOnly] = useState(false);
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [groupDialog, setGroupDialog] = useState("");
  const [groupName, setGroupName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [domainDraft, setDomainDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [noteForm, setNoteForm] = useState({
    id: null, title: "", content: "", topic: "", domain: "",
  });
  const [topicName, setTopicName] = useState("");

  const authenticate = async ({ mode, name, email, password }) => {
    setProfileBusy(true);
    setProfileError("");
    try {
      const response = await fetch(`${API_URL}/auth/${mode === "register" ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "register"
          ? { name, email, password }
          : { email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(apiErrorMessage(data.detail, "Authentication failed."));
      }
      if (!data.token || !data.user?.id || !data.user?.name) {
        throw new Error("The authentication API returned an unexpected response.");
      }
      const authenticatedUser = { ...data.user, token: data.token };
      localStorage.setItem(AUTH_KEY, JSON.stringify(authenticatedUser));
      setProfile(authenticatedUser);
    } catch (err) {
      setProfileError(
        err.message?.includes("Failed to fetch")
          ? "Couldn't reach the backend. Start FastAPI and try again."
          : err.message || "Couldn't sign in to StudyTrack."
      );
    } finally {
      setProfileBusy(false);
    }
  };

  const signOut = () => {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem("studytrack_workspace");
    setProfile(null);
    setSummary(null);
    setSessions([]);
    setNotes([]);
    setTopics([]);
    setGroups([]);
    setActiveGroupId("");
  };

  const loadDashboard = useCallback(async () => {
    try {
      const endpoints = [
        `/dashboard/summary${activeGroupId ? `?group_id=${activeGroupId}` : ""}`,
        `/sessions?limit=100${activeGroupId ? `&group_id=${activeGroupId}` : ""}`,
        `/notes${activeGroupId ? `?group_id=${activeGroupId}` : ""}`,
        `/topics${activeGroupId ? `?group_id=${activeGroupId}` : ""}`,
      ];
      const responses = await Promise.all(
        endpoints.map((endpoint) => apiFetch(profile.token, endpoint))
      );
      const failed = responses.find((r) => !r.ok);
      if (failed) throw new Error(`API request failed (${failed.status}). Check that your backend is running.`);
      const [summaryData, sessionData, noteData, topicData] =
        await Promise.all(responses.map((r) => r.json()));
      setError("");
      setSummary(summaryData);
      setSessions(sessionData);
      setNotes(noteData);
      setTopics(topicData);
      if (activeGroupId) {
        const [boardResponse, winnerResponse, roundWinnerResponse] = await Promise.all([
          apiFetch(profile.token, `/groups/${activeGroupId}/leaderboard`),
          apiFetch(profile.token, `/groups/${activeGroupId}/winners`),
          apiFetch(profile.token, `/groups/${activeGroupId}/round-winners`),
        ]);
        if (!boardResponse.ok || !winnerResponse.ok || !roundWinnerResponse.ok) {
          throw new Error("Could not load this group's competition results.");
        }
        setLeaderboard(await boardResponse.json());
        setWinners(await winnerResponse.json());
        setRoundWinners(await roundWinnerResponse.json());
      } else {
        setLeaderboard(null);
        setWinners([]);
        setRoundWinners([]);
      }
    } catch (err) {
      setError(err.message || "Couldn't connect to StudyTrack. Check the backend.");
    } finally {
      setLoading(false);
    }
  }, [profile, activeGroupId]);

  useEffect(() => {
    if (profile?.token) queueMicrotask(() => void loadDashboard());
  }, [profile?.token, activeGroupId, loadDashboard]);

  useEffect(() => {
    if (!profile?.token) return;
    apiFetch(profile.token, "/groups")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load your groups.");
        const availableGroups = await response.json();
        setGroups(availableGroups);
        const storedGroup = localStorage.getItem("studytrack_workspace") || "";
        const validGroup = availableGroups.some(
          (group) => String(group.id) === storedGroup
        ) ? storedGroup : "";
        setActiveGroupId(validGroup);
        if (!validGroup) localStorage.removeItem("studytrack_workspace");
      })
      .catch((err) => setError(err.message));
  }, [profile?.token]);

  const filteredSessions = sessions.filter((s) => {
    const q = search.toLowerCase();
    return (s.subject || "").toLowerCase().includes(q) ||
      (s.topic || "").toLowerCase().includes(q) ||
      (s.domain || "").toLowerCase().includes(q) ||
      (s.site_title || "").toLowerCase().includes(q) ||
      (s.site_url || "").toLowerCase().includes(q);
  });
  const filteredNotes = notes.filter((n) => {
    const q = search.toLowerCase();
    return (n.title || "").toLowerCase().includes(q) ||
      (n.content || "").toLowerCase().includes(q) ||
      (n.topic || "").toLowerCase().includes(q) ||
      (n.domain || "").toLowerCase().includes(q);
  });
  const weeklyData = (summary?.weekly_study || []).map((day) => ({
    day: new Date(`${day.date}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short" }),
    date: day.date,
    hours: Number((day.seconds / 3600).toFixed(2)),
  }));
  const todayLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long",
  });
  const selectedTopicDomains = topics.find(
    (topic) => topic.name === noteForm.topic
  )?.domains || [];

  async function submitTopic(event) {
    event.preventDefault();
    const name = topicName.trim();
    if (!name) return;
    setSaving(true); setNotice(""); setError("");
    try {
      const response = await apiFetch(profile.token, "/topics", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          group_id: activeGroupId ? Number(activeGroupId) : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Couldn't create the topic.");
      setTopicName(""); setShowTopicForm(false);
      setNotice("Topic created successfully.");
      await loadDashboard();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function submitNote(event) {
    event.preventDefault();
    if (!noteForm.title.trim()) return;
    setSaving(true); setNotice(""); setError("");
    try {
      const response = await apiFetch(
        profile.token,
        noteForm.id ? `/notes/${noteForm.id}` : "/notes",
        {
          method: noteForm.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: noteForm.title.trim(),
            content: noteForm.content,
            topic: noteForm.topic || "General",
            domain: noteForm.domain || "General",
            group_id: activeGroupId ? Number(activeGroupId) : null,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Couldn't save the note.");
      setNoteForm({ id: null, title: "", content: "", topic: "", domain: "" });
      setShowNoteForm(false); setNotice("Note saved successfully.");
      await loadDashboard();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function submitGroupAction(event) {
    event.preventDefault();
    const creating = groupDialog === "create";
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch(
        profile.token,
        creating ? "/groups" : "/groups/join",
        {
          method: "POST",
          body: JSON.stringify(creating
            ? { name: groupName.trim() }
            : { invite_code: inviteCode.trim() }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : "Couldn't update groups.");
      }
      setGroups((current) => [
        ...current.filter((group) => group.id !== data.id),
        data,
      ]);
      setActiveGroupId(String(data.id));
      localStorage.setItem("studytrack_workspace", String(data.id));
      setGroupName("");
      setInviteCode("");
      setGroupDialog("");
      setNotice(creating
        ? `Group created. Share invite code ${data.invite_code} with members.`
        : `Joined ${data.name}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitDomain(topicId, event) {
    event.preventDefault();
    const name = domainDraft?.name?.trim();
    if (!name) return;
    setSaving(true);
    try {
      const response = await apiFetch(profile.token, `/topics/${topicId}/domains`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : "Couldn't create the domain.");
      }
      setDomainDraft(null);
      setNotice(`${data.name} added to the topic.`);
      await loadDashboard();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function startNotePage(topic = "", domain = "") {
    setNoteForm({ id: null, title: "", content: "", topic, domain });
    setNoteReadOnly(false);
    setShowNoteForm(true);
  }

  function openNotePage(note) {
    setNoteForm({
      id: note.id,
      title: note.title,
      content: note.content || "",
      topic: note.topic || "General",
      domain: note.domain || "General",
    });
    setNoteReadOnly(!note.can_edit);
    setShowNoteForm(true);
  }

  async function deleteNotePage(note) {
    if (!window.confirm(`Delete the note page "${note.title}"?`)) return;
    try {
      const response = await apiFetch(profile.token, `/notes/${note.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Couldn't delete this note page.");
      setNotice("Note page deleted.");
      await loadDashboard();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cleanupOldSessions() {
    if (!window.confirm("Delete your study sessions older than 90 days? Notes and monthly winners will be kept.")) return;
    try {
      const response = await apiFetch(
        profile.token,
        "/maintenance/cleanup-old-sessions",
        { method: "POST" }
      );
      const result = await response.json();
      if (!response.ok) throw new Error("Couldn't clean up old study time.");
      setNotice(`${result.deleted_sessions} old study sessions removed. Notes were kept.`);
      await loadDashboard();
    } catch (err) {
      setError(err.message);
    }
  }

  function changeWorkspace(nextGroupId) {
    setActiveGroupId(nextGroupId);
    if (nextGroupId) localStorage.setItem("studytrack_workspace", nextGroupId);
    else localStorage.removeItem("studytrack_workspace");
  }

  const pageTitles = {
    overview: ["Your study space", "Here's how your learning is going."],
    sessions: ["Study sessions", "Review the time you've spent learning."],
    notes: ["My notes", "Keep your learning and ideas in one place."],
    topics: ["Your topics", "Organize your learning by subject."],
    competition: ["Date-round competition", "Track 1–8 day rounds and your group’s monthly champion."],
  };
  const [pageTitle, pageSubtitle] = pageTitles[activePage];

  if (!profile?.token) {
    return <AuthWelcome onAuthenticate={authenticate} busy={profileBusy} error={profileError} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><BookOpen size={23} /></div>
          <div><span className="brand-name">studytrack</span><span className="brand-caption">YOUR LEARNING SPACE</span></div>
        </div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <div className="workspace-switcher">
          <label htmlFor="workspace-select">Study mode</label>
          <select id="workspace-select" value={activeGroupId}
            onChange={(event) => changeWorkspace(event.target.value)}>
            <option value="">Individual workspace</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
          <button type="button" className="workspace-action" onClick={() => setGroupDialog("create")}>
            <Plus size={14} /> Create group
          </button>
          <button type="button" className="workspace-action" onClick={() => setGroupDialog("join")}>
            <Users size={14} /> Join with code
          </button>
        </div>
        <nav className="navigation" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button className={`nav-item ${activePage === id ? "active" : ""}`} key={id}
              onClick={() => { setActivePage(id); setSearch(""); }}>
              <Icon size={19} /><span>{label}</span>
              {id === "notes" && notes.length > 0 && <span className="nav-count">{notes.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="focus-card">
            <div className="focus-card-icon"><Flame size={18} /></div>
            <p className="focus-title">Small steps add up.</p>
            <p className="focus-description">Every focused minute moves you forward.</p>
            <div className="focus-progress"><span /></div>
            <div className="focus-footer"><span>Keep learning</span><Target size={15} /></div>
          </div>
          <button className="profile" onClick={signOut} title="Sign out">
            <div className="avatar">{getInitials(profile.name)}</div>
            <div className="profile-info"><strong>{profile.name}</strong><span>Sign out</span></div>
            <LogOut size={16} className="profile-chevron" />
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-separator">/</span><strong>{navigation.find((item) => item.id === activePage)?.label}</strong></div>
          <label className="topbar-workspace" htmlFor="mobile-workspace-select">
            <span>Workspace</span>
            <select id="mobile-workspace-select" value={activeGroupId}
              onChange={(event) => changeWorkspace(event.target.value)}>
              <option value="">Individual</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <div className="topbar-right">
            <span className="connection-status"><span className={`status-dot ${error ? "offline" : ""}`} />{error ? "Connection issue" : "StudyTrack API"}</span>
            <button className="icon-button" title="Refresh dashboard" aria-label="Refresh dashboard" onClick={() => { setLoading(true); void loadDashboard(); }} disabled={loading}><RefreshCw size={17} className={loading ? "spin" : ""} /></button>
            <div className="avatar top-avatar">{getInitials(profile.name)}</div>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div><div className="eyebrow"><span className="eyebrow-dot" /> YOUR PERSONAL LEARNING DASHBOARD</div><h1>{pageTitle}</h1><p className="page-subtitle">{pageSubtitle}</p></div>
            <div className="date-chip"><Clock3 size={16} />{todayLabel}</div>
          </section>

          {error && <div className="alert alert-error"><span>{error}</span><button onClick={() => { setLoading(true); void loadDashboard(); }} className="alert-action">Retry</button></div>}
          {notice && <div className="alert alert-success"><Check size={17} /><span>{notice}</span><button className="alert-dismiss" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16} /></button></div>}

          {activePage === "overview" && <>
            <section className="stats-grid">
              <StatCard title="Total study time" value={loading && !summary ? "—" : formatDuration(summary?.total_seconds)} subtitle="Across all recorded sessions" icon={Clock3} tone="purple" />
              <StatCard title="Study sessions" value={summary?.sessions_count ?? "—"} subtitle="Sessions recorded so far" icon={Activity} tone="blue" />
              <StatCard title="Notes collected" value={summary?.notes_count ?? "—"} subtitle="Ideas saved for later" icon={FileText} tone="orange" />
              <StatCard title="Learning topics" value={summary?.topics_count ?? "—"} subtitle="Subjects you're exploring" icon={FolderOpen} tone="green" />
            </section>
            <section className="dashboard-grid">
              <article className="panel chart-panel">
                <div className="panel-heading"><div><h2>Your study rhythm</h2><p>Daily study time over the last 7 days</p></div><span className="panel-badge">THIS WEEK</span></div>
                <div className="chart-legend"><span className="legend-dot" /><span>Study hours</span></div>
                <div className="chart-container">
                  {weeklyData.length ? <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyData} margin={{ top: 12, right: 8, left: -20, bottom: 0 }} barSize={28}>
                      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#ececf3" />
                      <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#9292a5", fontSize: 12 }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: "#9292a5", fontSize: 11 }} tickFormatter={(v) => `${v}h`} />
                      <Tooltip cursor={{ fill: "#f5f3ff" }} formatter={(v) => [`${v} hours`, "Study time"]} labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ""} contentStyle={{ borderRadius: 12, border: "1px solid #eeeaf9", boxShadow: "0 8px 24px #29205b12" }} />
                      <Bar dataKey="hours" fill="#7661e8" radius={[7, 7, 2, 2]} minPointSize={3} />
                    </BarChart>
                  </ResponsiveContainer> : <EmptyState icon={Activity} title="Your study rhythm starts here" description="Record a study session to see your weekly progress." />}
                </div>
              </article>
              <article className="panel today-panel">
                <div className="panel-heading"><div><h2>Today's focus</h2><p>Your progress for today</p></div><span className="today-icon"><Target size={19} /></span></div>
                <div className="today-time">{formatDuration(summary?.today_seconds)}</div><p className="today-caption">Study time recorded today</p>
                <div className="today-divider" />
                <div className="today-metric"><span className="today-metric-icon purple-soft"><ArrowUpRight size={17} /></span><div><strong>{summary?.sessions_count ?? 0}</strong><span>Total sessions</span></div></div>
                <div className="today-metric"><span className="today-metric-icon green-soft"><Check size={17} /></span><div><strong>{summary?.topics_count ?? 0}</strong><span>Topics to explore</span></div></div>
                <div className="encouragement"><Flame size={17} /><span>Consistency matters more than perfection.</span></div>
              </article>
            </section>
            <section className="panel recent-panel">
              <div className="panel-heading"><div><h2>Recent study sessions</h2><p>A quick look at your latest learning activity</p></div><button className="text-button" onClick={() => setActivePage("sessions")}>View all <ArrowUpRight size={15} /></button></div>
              <SessionTable sessions={sessions.slice(0, 5)} loading={loading} />
            </section>
            <section className="bottom-grid">
              <article className="panel compact-panel">
                <div className="panel-heading"><div><h2>Recently saved notes</h2><p>Ideas worth remembering</p></div><button className="text-button" onClick={() => setActivePage("notes")}>View all <ArrowUpRight size={15} /></button></div>
                {notes.length === 0 ? <EmptyState icon={FileText} title="No notes yet" description="Save an idea and it'll show up here." /> : <div className="mini-list">{notes.slice(0, 3).map((note) => <div className="mini-item" key={note.id}><span className="mini-item-icon"><FileText size={17} /></span><div className="mini-item-content"><strong>{note.title}</strong><span>{note.topic || "General"} · {formatDate(note.updated_at)}</span></div></div>)}</div>}
              </article>
              <article className="panel compact-panel">
                <div className="panel-heading"><div><h2>Your learning topics</h2><p>What you're working on</p></div><button className="text-button" onClick={() => setActivePage("topics")}>View all <ArrowUpRight size={15} /></button></div>
                {topics.length === 0 ? <EmptyState icon={FolderOpen} title="No topics yet" description="Create a topic to organize your notes." /> : <div className="topic-chips">{topics.slice(0, 8).map((topic, i) => <span className={`topic-chip topic-color-${i % 4}`} key={topic.id}><span />{topic.name}</span>)}</div>}
              </article>
            </section>
          </>}

          {activePage === "sessions" && <section className="panel page-panel">
            <div className="panel-heading page-panel-heading">
              <div><h2>All study sessions</h2><p>{sessions.length} sessions recorded in this workspace · records older than 90 days are removed automatically; notes are kept</p></div>
              <button className="secondary-button" onClick={cleanupOldSessions}><Trash2 size={16} /> Clean up now</button>
            </div>
            <SearchBox value={search} onChange={setSearch} />
            <GroupedSessions sessions={filteredSessions} loading={loading} />
          </section>}

          {activePage === "notes" && <section className="panel page-panel">
            <div className="panel-heading page-panel-heading"><div><h2>Topic notebooks</h2><p>Each note is a separate page inside its topic and domain.</p></div><button className="primary-button" onClick={() => startNotePage()}><Plus size={17} /> New page</button></div>
            <SearchBox value={search} onChange={setSearch} />
            {filteredNotes.length === 0 ? <EmptyState icon={FileText} title="No note pages yet" description="Create a page inside a topic to start a notebook." /> : <div className="note-topic-groups">
              {topics.map((topic) => {
                const pages = filteredNotes.filter((note) => note.topic === topic.name);
                if (!pages.length) return null;
                return <section className="note-topic-group" key={topic.id}>
                  <div className="topic-group-heading"><div><h3>{topic.name}</h3><span>{pages.length} pages</span></div><button className="text-button" onClick={() => startNotePage(topic.name)}><Plus size={15} /> New page</button></div>
                  <div className="notes-grid">{pages.map((note) => <article className="note-card" key={note.id}>
                    <div className="note-card-top"><span className="note-card-icon"><FileText size={18} /></span><span className="note-date">{formatDate(note.updated_at)}</span></div>
                    <button className="note-page-open"
                      title={note.can_edit ? "Open note page" : "View shared note page"}
                      onClick={() => openNotePage(note)}>
                      <h3>{note.title}</h3><p className="note-preview">{note.content || "No additional content."}</p>
                    </button>
                    <div className="note-card-footer"><span className="note-topic">{note.domain || "General"}</span>{note.can_edit && <button className="note-delete" onClick={() => deleteNotePage(note)} aria-label={`Delete ${note.title}`} title="Delete page"><Trash2 size={15} /></button>}</div>
                  </article>)}</div>
                </section>;
              })}
              {filteredNotes.some((note) => !topics.some((topic) => topic.name === note.topic)) && <section className="note-topic-group">
                <div className="topic-group-heading"><div><h3>General pages</h3></div></div>
                <div className="notes-grid">{filteredNotes.filter((note) => !topics.some((topic) => topic.name === note.topic)).map((note) => <article className="note-card" key={note.id}>
                  <div className="note-card-top"><span className="note-card-icon"><FileText size={18} /></span><span className="note-date">{formatDate(note.updated_at)}</span></div>
                  <button className="note-page-open"
                    title={note.can_edit ? "Open note page" : "View shared note page"}
                    onClick={() => openNotePage(note)}><h3>{note.title}</h3><p className="note-preview">{note.content || "No additional content."}</p></button>
                  <div className="note-card-footer"><span className="note-topic">{note.topic || "General"} · {note.domain || "General"}</span>{note.can_edit && <button className="note-delete" onClick={() => deleteNotePage(note)} aria-label={`Delete ${note.title}`} title="Delete page"><Trash2 size={15} /></button>}</div>
                </article>)}</div>
              </section>}
            </div>}
          </section>}

          {activePage === "topics" && <section className="panel page-panel">
            <div className="panel-heading page-panel-heading"><div><h2>Topics and domains</h2><p>Build a subject map, then create note pages inside each domain.</p></div><button className="primary-button" onClick={() => setShowTopicForm(true)}><Plus size={17} /> New topic</button></div>
            {topics.length === 0 ? <EmptyState icon={FolderOpen} title="Your topic map starts here" description="Create DSA or another subject, then add domains like arrays, trees, and graphs." /> : <div className="topics-grid">{topics.map((topic, i) => {
              const topicNotes = notes.filter((note) => note.topic === topic.name).length;
              const topicSessions = sessions.filter((session) => session.topic === topic.name).length;
              return <article className="topic-card" key={topic.id}>
                <div className={`topic-card-icon topic-color-${i % 4}`}>{i % 2 === 0 ? <BookOpen size={21} /> : <Code2 size={21} />}</div>
                <h3>{topic.name}</h3>
                <div className="topic-card-stats"><span>{topicNotes} pages</span><span>{topicSessions} sessions</span></div>
                <div className="domain-widgets">
                  {(topic.domains || []).map((domain) => {
                    const domainPages = notes.filter((note) => note.topic === topic.name && note.domain === domain.name).length;
                    const domainSeconds = sessions.filter((session) => session.topic === topic.name && session.domain === domain.name).reduce((total, session) => total + session.duration_seconds, 0);
                    return <button className="domain-widget" key={domain.id} onClick={() => startNotePage(topic.name, domain.name)}>
                      <strong>{domain.name}</strong><span>{domainPages} pages · {formatDuration(domainSeconds)}</span>
                    </button>;
                  })}
                  {topic.domains?.length === 0 && <p className="empty-domain">Add domains to organize this topic.</p>}
                </div>
                {domainDraft?.topicId === topic.id ? <form className="domain-form" onSubmit={(event) => submitDomain(topic.id, event)}>
                  <input autoFocus required maxLength={100} value={domainDraft.name} placeholder="e.g. Trees and graphs" onChange={(event) => setDomainDraft({ ...domainDraft, name: event.target.value })} />
                  <button className="primary-button" disabled={saving}>Add</button>
                  <button type="button" className="icon-button" onClick={() => setDomainDraft(null)} aria-label="Cancel domain"><X size={15} /></button>
                </form> : <div className="topic-actions">
                  <button className="text-button" onClick={() => setDomainDraft({ topicId: topic.id, name: "" })}><Plus size={15} /> Add domain</button>
                  <button className="text-button" onClick={() => startNotePage(topic.name)}><FileText size={15} /> New page</button>
                </div>}
              </article>;
            })}</div>}
          </section>}

          {activePage === "competition" && <>
            {!activeGroupId ? <section className="panel page-panel">
              <EmptyState icon={Users} title="Choose a group workspace" description="Create a group or join with an invite code to view date-round standings and monthly winners." />
              <div className="competition-actions"><button className="primary-button" onClick={() => setGroupDialog("create")}><Plus size={16} /> Create group</button><button className="secondary-button" onClick={() => setGroupDialog("join")}><Users size={16} /> Join group</button></div>
            </section> : <>
              <section className="panel page-panel">
                <div className="panel-heading page-panel-heading"><div><span className="modal-kicker">DATE ROUND STANDINGS</span><h2>{groups.find((group) => String(group.id) === activeGroupId)?.name || "Group"}</h2><p>Current round: {formatDate(leaderboard?.period_start)} – {formatDate(leaderboard?.period_end)}</p><p>Monthly champion counts study time from {formatDate(leaderboard?.month_start)} to {formatDate(leaderboard?.month_end)}.</p></div><Trophy size={24} /></div>
                <div className="invite-code-row"><span>Invite code</span><strong>{groups.find((group) => String(group.id) === activeGroupId)?.invite_code || ""}</strong><span>Share this code with your group</span></div>
                <div className="table-scroll"><table className="sessions-table"><thead><tr><th>RANK</th><th>MEMBER</th><th>STUDY TIME</th></tr></thead><tbody>
                  {(leaderboard?.leaderboard || []).map((member, index) => <tr key={member.user_id}><td>{index + 1}</td><td><strong>{member.name}</strong></td><td>{formatDuration(member.seconds)}</td></tr>)}
                  {leaderboard?.leaderboard?.length === 0 && <tr><td colSpan="3">No members in this group yet.</td></tr>}
                </tbody></table></div>
              </section>
              <section className="panel page-panel winner-history">
                <div className="panel-heading page-panel-heading"><div><h2>Date-round winners</h2><p>Each completed date block gets its own winner: 1–8, 9–16, 17–24, and 25–month-end.</p></div><Trophy size={20} /></div>
                {roundWinners.length ? <div className="winner-list">{roundWinners.map((winner, index) => <article className="winner-row" key={winner.period_start}>
                  <span className="winner-rank">{index + 1}</span><div><strong>{winner.winner}</strong><span>{formatDate(winner.period_start)} – {formatDate(winner.period_end)}</span></div><b>{formatDuration(winner.seconds)}</b>
                </article>)}</div> : <EmptyState icon={Trophy} title="First round winner is pending" description="The current round winner is saved after its date range closes." />}
              </section>
              <section className="panel page-panel winner-history">
                <div className="panel-heading page-panel-heading"><div><h2>Monthly champion</h2><p>The champion is decided from the full month’s group study time and saved after month-end.</p></div><Trophy size={20} /></div>
                <div className="monthly-winner-status">
                  <span>This month</span>
                  {leaderboard?.month_winner
                    ? <><strong>{leaderboard.month_winner.name}</strong><b>{formatDuration(leaderboard.month_winner.seconds)}</b></>
                    : <strong>Winner announced after {formatDate(leaderboard?.month_end)}</strong>}
                </div>
                <div className="panel-heading page-panel-heading monthly-history-heading"><div><h3>Recent monthly winners</h3><p>Saved winner records stay available if time data is cleaned up.</p></div></div>
                {winners.length ? <div className="winner-list">{winners.map((winner, index) => <article className="winner-row" key={winner.period_start}>
                  <span className="winner-rank">{index + 1}</span><div><strong>{winner.winner}</strong><span>{formatDate(winner.period_start)} – {formatDate(winner.period_end)}</span></div><b>{formatDuration(winner.seconds)}</b>
                </article>)}</div> : <EmptyState icon={Trophy} title="No monthly champion yet" description="The current month stays open until its final day." />}
              </section>
            </>}
          </>}

          <footer className="page-footer"><span>Made for focused learning.</span><span><span className="footer-dot" /> StudyTrack · {profile.name}'s workspace</span></footer>
        </div>
      </main>

      {groupDialog && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setGroupDialog(""); }}>
        <section className="modal modal-small" role="dialog" aria-modal="true">
          <div className="modal-header"><div><span className="modal-kicker">WORKSPACE</span><h2>{groupDialog === "create" ? "Create a study group" : "Join a study group"}</h2><p>{groupDialog === "create" ? "Your invite code will let other members join." : "Enter the invite code shared by a group member."}</p></div><button className="icon-button" onClick={() => setGroupDialog("")} aria-label="Close"><X size={18} /></button></div>
          <form onSubmit={submitGroupAction} className="modal-form">
            {groupDialog === "create" ? <><label htmlFor="group-name">Group name</label><input id="group-name" autoFocus required minLength={2} maxLength={100} placeholder="e.g. DSA Study Circle" value={groupName} onChange={(event) => setGroupName(event.target.value)} /></> : <><label htmlFor="group-invite">Invite code</label><input id="group-invite" autoFocus required maxLength={16} autoCapitalize="characters" placeholder="Enter group code" value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} /></>}
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setGroupDialog("")}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Users size={17} />}{groupDialog === "create" ? "Create group" : "Join group"}</button></div>
          </form>
        </section>
      </div>}

      {showNoteForm && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowNoteForm(false); }}>
        <section className="modal" role="dialog" aria-modal="true">
          <div className="modal-header"><div><span className="modal-kicker">TOPIC NOTEBOOK</span><h2>{noteReadOnly ? "View note page" : noteForm.id ? "Edit note page" : "Create a note page"}</h2><p>{noteReadOnly ? "Shared with everyone in this group." : "Save a separate page inside a topic and domain."}</p></div><button className="icon-button" onClick={() => setShowNoteForm(false)} aria-label="Close"><X size={18} /></button></div>
          <form onSubmit={submitNote} className="modal-form">
            <label htmlFor="note-title">Page title</label><input id="note-title" autoFocus={!noteReadOnly} readOnly={noteReadOnly} required maxLength={200} placeholder="e.g. Binary search — key idea" value={noteForm.title} onChange={(e) => setNoteForm({ ...noteForm, title: e.target.value })} />
            <label htmlFor="note-topic">Topic</label><select id="note-topic" disabled={noteReadOnly} value={noteForm.topic} onChange={(e) => setNoteForm({ ...noteForm, topic: e.target.value, domain: "" })}><option value="">General</option>{topics.map((topic) => <option key={topic.id} value={topic.name}>{topic.name}</option>)}</select>
            <label htmlFor="note-domain">Domain</label><select id="note-domain" disabled={noteReadOnly} value={noteForm.domain} onChange={(e) => setNoteForm({ ...noteForm, domain: e.target.value })}><option value="">General</option>{selectedTopicDomains.map((domain) => <option key={domain.id} value={domain.name}>{domain.name}</option>)}</select>
            <label htmlFor="note-content">Page content</label><textarea id="note-content" readOnly={noteReadOnly} rows={8} placeholder="Write down the important points..." value={noteForm.content} onChange={(e) => setNoteForm({ ...noteForm, content: e.target.value })} />
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowNoteForm(false)}>{noteReadOnly ? "Close" : "Cancel"}</button>{!noteReadOnly && <button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} Save page</button>}</div>
          </form>
        </section>
      </div>}

      {showTopicForm && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowTopicForm(false); }}>
        <section className="modal modal-small" role="dialog" aria-modal="true">
          <div className="modal-header"><div><span className="modal-kicker">ORGANIZE YOUR LEARNING</span><h2>Create a topic</h2><p>Give your next learning goal a name.</p></div><button className="icon-button" onClick={() => setShowTopicForm(false)} aria-label="Close"><X size={18} /></button></div>
          <form onSubmit={submitTopic} className="modal-form">
            <label htmlFor="topic-name">Topic name</label><input id="topic-name" autoFocus required maxLength={80} placeholder="e.g. Data Structures" value={topicName} onChange={(e) => setTopicName(e.target.value)} />
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowTopicForm(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} Create topic</button></div>
          </form>
        </section>
      </div>}
    </div>
  );
}
