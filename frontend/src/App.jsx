
import { useCallback, useEffect, useState } from "react";
import {
  Activity, ArrowUpRight, Bell, BellRing, BookOpen, Check, CheckCheck,
  Clock3, Code2, FileText, Flame, FolderOpen,
  LayoutDashboard, LoaderCircle, LogOut, PartyPopper, Plus, RefreshCw,
  Search, Sparkles, Target, Trash2, Trophy, UserRound, Users, X,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from "recharts";

const API_URL = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const AUTH_KEY = "studytrack_auth";

function readLocalArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function roundWinnerNotificationId(groupId, periodStart) {
  return `round-winner:${groupId}:${periodStart}`;
}

// Returns today's date in the browser's local timezone (YYYY-MM-DD).
function getTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

function StreakCalendar({ days = [], streak = 0 }) {
  if (!days.length) return null;

  const firstDate = new Date(`${days[0].date}T12:00:00`);
  const leadingBlanks = (firstDate.getDay() + 6) % 7;
  const cells = [
    ...Array.from({ length: leadingBlanks }, (_, index) => ({
      key: `blank-${index}`,
      blank: true,
    })),
    ...days.map((day) => ({ ...day, key: day.date })),
  ];
  const maxSeconds = Math.max(1, ...days.map((day) => day.seconds || 0));

  function level(seconds) {
    if (!seconds) return 0;
    const ratio = seconds / maxSeconds;
    if (ratio < 0.25) return 1;
    if (ratio < 0.5) return 2;
    if (ratio < 0.75) return 3;
    return 4;
  }

  return (
    <section className="streak-calendar" aria-label="Daily study streak calendar">
      <div className="streak-calendar-heading">
        <div>
          <strong>{streak} day{streak === 1 ? "" : "s"} streak</strong>
          <span>Study activity over the last {days.length} days</span>
        </div>
        <div className="streak-legend" aria-label="Less to more study time">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((value) => <i key={value} className={`streak-cell level-${value}`} />)}
          <span>More</span>
        </div>
      </div>
      <div className="streak-calendar-scroll">
        <div className="streak-calendar-grid">
          {cells.map((day) => day.blank
            ? <span className="streak-cell streak-cell-blank" key={day.key} aria-hidden="true" />
            : <span
                className={`streak-cell level-${level(day.seconds)}`}
                key={day.key}
                title={`${formatDate(day.date)} · ${formatDuration(day.seconds)}`}
                aria-label={`${formatDate(day.date)}: ${formatDuration(day.seconds)} study time`}
              />)}
        </div>
      </div>
    </section>
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
  const [notifications, setNotifications] = useState(() =>
    profile?.id ? readLocalArray(`studytrack_notifications_${profile.id}`) : []
  );
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [selectedRoundWinner, setSelectedRoundWinner] = useState(null);
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  );
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
  const [showManualSessionForm, setShowManualSessionForm] = useState(false);
  const [manualSession, setManualSession] = useState({
    topic: "", domain: "", activity: "", date: getTodayDate(),
    startTime: "09:00", hours: "0", minutes: "30",
  });
  const [manualSessionError, setManualSessionError] = useState("");
  const [showManualDomainForm, setShowManualDomainForm] = useState(false);
  const [manualDomainName, setManualDomainName] = useState("");
  const [manualDomainError, setManualDomainError] = useState("");

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

  const checkRoundWinnerAnnouncements = useCallback(async () => {
    if (!profile?.token || !groups.length) return;
    try {
      const notificationKey = `studytrack_notifications_${profile.id}`;
      const previousNotifications = readLocalArray(notificationKey);
      const allFreshNotifications = [];

      // Check every group the user belongs to, even while using Individual workspace.
      for (const group of groups) {
        const groupId = String(group.id);
        const response = await apiFetch(
          profile.token,
          `/groups/${groupId}/round-winners`
        );
        if (!response.ok) continue;
        const currentWinners = await response.json();
        if (!Array.isArray(currentWinners)) continue;

        const knownKey = `studytrack_known_round_winners_${profile.id}_${groupId}`;
        const currentKeys = currentWinners
          .filter((winner) => winner?.period_start)
          .map((winner) => roundWinnerNotificationId(groupId, winner.period_start));
        const storedKnown = localStorage.getItem(knownKey);

        // First visit establishes a baseline. Historical winners are not announced as new.
        if (storedKnown === null) {
          localStorage.setItem(knownKey, JSON.stringify(currentKeys));
          continue;
        }

        let knownKeys = [];
        try {
          const parsed = JSON.parse(storedKnown);
          knownKeys = Array.isArray(parsed) ? parsed : [];
        } catch {
          knownKeys = [];
        }
        const knownSet = new Set(knownKeys);
        const freshWinners = currentWinners.filter((winner) =>
          winner?.period_start && winner.winner && winner.winner !== "No activity" &&
          Number(winner.seconds) > 0 && !knownSet.has(
            roundWinnerNotificationId(groupId, winner.period_start)
          )
        );
        if (!freshWinners.length) continue;

        const createdAt = new Date().toISOString();
        const newNotifications = freshWinners.map((winner) => ({
          id: roundWinnerNotificationId(groupId, winner.period_start),
          groupId,
          groupName: group.name || "Your study group",
          winner: winner.winner,
          period_start: winner.period_start,
          period_end: winner.period_end,
          seconds: Number(winner.seconds) || 0,
          createdAt,
          read: false,
        }));
        allFreshNotifications.push(...newNotifications);
        localStorage.setItem(knownKey, JSON.stringify([
          ...knownKeys,
          ...newNotifications.map((item) => item.id),
        ]));
      }

      if (!allFreshNotifications.length) return;
      const mergedNotifications = [...allFreshNotifications, ...previousNotifications]
        .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
        .slice(0, 100);
      localStorage.setItem(notificationKey, JSON.stringify(mergedNotifications));
      setNotifications(mergedNotifications);

      if ("Notification" in window && Notification.permission === "granted") {
        allFreshNotifications.forEach((item) => {
          const browserNotice = new Notification(`🏆 ${item.winner} won ${item.groupName}!`, {
            body: `${formatDate(item.period_start)} – ${formatDate(item.period_end)} · ${formatDuration(item.seconds)} study time`,
            tag: item.id,
          });
          browserNotice.onclick = () => window.focus();
        });
      }
    } catch (err) {
      console.warn("Could not check round-winner announcements:", err);
    }
  }, [profile, groups]);

  useEffect(() => {
    if (profile?.token) queueMicrotask(() => void loadDashboard());
  }, [profile?.token, activeGroupId, loadDashboard]);

  useEffect(() => {
    if (!profile?.token || !groups.length) return undefined;
    void checkRoundWinnerAnnouncements();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkRoundWinnerAnnouncements();
      }
    }, 45000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void checkRoundWinnerAnnouncements();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [profile?.token, groups, checkRoundWinnerAnnouncements]);

  useEffect(() => {
    if (!profile?.id) return;
    setNotifications(readLocalArray(`studytrack_notifications_${profile.id}`));
  }, [profile?.id]);

  useEffect(() => {
    if (!("Notification" in window)) {
      setBrowserNotificationPermission("unsupported");
      return;
    }
    setBrowserNotificationPermission(Notification.permission);
  }, []);

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

  async function submitManualDomain(event) {
    event.preventDefault();
    setManualDomainError("");
    const selectedTopic = topics.find((topic) => topic.name === manualSession.topic);
    const name = manualDomainName.trim();

    if (!selectedTopic) {
      setManualDomainError("Please select a topic before creating a domain.");
      return;
    }
    if (!name) {
      setManualDomainError("Please enter a domain name.");
      return;
    }
    if ((selectedTopic.domains || []).some((domain) => domain.name.toLowerCase() === name.toLowerCase())) {
      setManualDomainError("This domain already exists in the selected topic.");
      return;
    }

    setSaving(true);
    try {
      const response = await apiFetch(profile.token, `/topics/${selectedTopic.id}/domains`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(apiErrorMessage(data.detail, "Couldn't create the domain."));
      }

      setManualSession((current) => ({ ...current, domain: data.name || name }));
      setManualDomainName("");
      setShowManualDomainForm(false);
      setNotice(`${data.name || name} added to ${selectedTopic.name}.`);
      await loadDashboard();
    } catch (err) {
      setManualDomainError(err.message || "Couldn't create the domain.");
    } finally {
      setSaving(false);
    }
  }

  async function submitManualSession(event) {
    event.preventDefault();
    setManualSessionError("");
    setError("");
    setNotice("");

    const hours = Number(manualSession.hours);
    const minutes = Number(manualSession.minutes);
    const durationSeconds = (hours * 3600) + (minutes * 60);
    if (!manualSession.date || !manualSession.startTime) {
      setManualSessionError("Please choose the study date and start time.");
      return;
    }
    const todayDate = getTodayDate();
    if (manualSession.date !== todayDate) {
      setManualSessionError("Manual study time can only be added for today. Past and future dates aren't allowed.");
      return;
    }
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0 || minutes > 59) {
      setManualSessionError("Enter valid hours and minutes (minutes must be 0–59).");
      return;
    }
    if (durationSeconds <= 0 || durationSeconds > 86400) {
      setManualSessionError("Study duration must be between 1 minute and 24 hours.");
      return;
    }

    // Construct the selected local date/time, then send an ISO timestamp to the API.
    const startedAt = new Date(`${manualSession.date}T${manualSession.startTime}:00`);
    if (Number.isNaN(startedAt.getTime())) {
      setManualSessionError("Please enter a valid date and start time.");
      return;
    }
    const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
    if (endedAt.getTime() > Date.now()) {
      setManualSessionError("The study session cannot end in the future. Check the date, start time and duration.");
      return;
    }

    setSaving(true);
    try {
      const response = await apiFetch(profile.token, "/sessions", {
        method: "POST",
        body: JSON.stringify({
          topic: manualSession.topic.trim() || "General",
          domain: manualSession.domain.trim() || null,
          duration_seconds: durationSeconds,
          started_at: startedAt.toISOString(),
          ended_at: endedAt.toISOString(),
          site_url: null,
          site_title: manualSession.activity.trim() || "Manual study session",
          group_id: activeGroupId ? Number(activeGroupId) : null,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(apiErrorMessage(result.detail, "Couldn't save this study session."));
      }
      setShowManualSessionForm(false);
      setManualSession({
        topic: "", domain: "", activity: "", date: getTodayDate(),
        startTime: "09:00", hours: "0", minutes: "30",
      });
      setNotice("Manual study time saved successfully.");
      await loadDashboard();
    } catch (err) {
      setManualSessionError(err.message || "Couldn't save this study session.");
    } finally {
      setSaving(false);
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

  function requestBrowserNotifications() {
    if (!("Notification" in window)) {
      setBrowserNotificationPermission("unsupported");
      return;
    }
    Notification.requestPermission().then((permission) => {
      setBrowserNotificationPermission(permission);
      if (permission === "granted") {
        setNotice("Browser notifications enabled for new group winners.");
      }
    });
  }

  function markNotificationRead(notificationId) {
    const updated = notifications.map((item) =>
      item.id === notificationId ? { ...item, read: true } : item
    );
    setNotifications(updated);
    if (profile?.id) {
      localStorage.setItem(`studytrack_notifications_${profile.id}`, JSON.stringify(updated));
    }
  }

  function markAllNotificationsRead() {
    const updated = notifications.map((item) => ({ ...item, read: true }));
    setNotifications(updated);
    if (profile?.id) {
      localStorage.setItem(`studytrack_notifications_${profile.id}`, JSON.stringify(updated));
    }
  }

  function openWinnerFromNotification(item) {
    markNotificationRead(item.id);
    setActivePage("competition");
    if (String(item.groupId) !== activeGroupId) changeWorkspace(String(item.groupId));
    setSelectedRoundWinner(item);
    setShowNotificationPanel(false);
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
    competition: ["Date-round competition", "Track four weekly rounds and your group’s monthly champion."],
  };
  const [pageTitle, pageSubtitle] = pageTitles[activePage];
  const unreadNotificationCount = notifications.filter((item) => !item.read).length;

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
            <div className="notification-anchor">
              <button type="button" className={`icon-button notification-bell ${unreadNotificationCount ? "has-unread" : ""}`} title="Notifications" aria-label={`Notifications${unreadNotificationCount ? `, ${unreadNotificationCount} unread` : ""}`} onClick={() => setShowNotificationPanel((value) => !value)}>
                {unreadNotificationCount ? <BellRing size={18} /> : <Bell size={18} />}
                {unreadNotificationCount > 0 && <span className="notification-count">{unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}</span>}
              </button>
              {showNotificationPanel && <section className="notification-panel" aria-label="Notifications">
                <div className="notification-panel-heading"><div><strong>Notifications</strong><span>{unreadNotificationCount ? `${unreadNotificationCount} unread` : "You're all caught up"}</span></div><button type="button" className="icon-button" onClick={() => setShowNotificationPanel(false)} aria-label="Close notifications"><X size={16} /></button></div>
                <div className="notification-settings-row">
                  {browserNotificationPermission === "granted"
                    ? <span className="notification-permission enabled"><Check size={14} /> Browser alerts enabled</span>
                    : browserNotificationPermission === "denied"
                      ? <span className="notification-permission">Browser alerts blocked in browser settings</span>
                      : browserNotificationPermission === "unsupported"
                        ? <span className="notification-permission">Browser alerts aren't supported here</span>
                        : <button type="button" className="text-button" onClick={requestBrowserNotifications}><Bell size={14} /> Enable browser notifications</button>}
                  {unreadNotificationCount > 0 && <button type="button" className="text-button" onClick={markAllNotificationsRead}><CheckCheck size={14} /> Mark all read</button>}
                </div>
                <div className="notification-list">
                  {notifications.length ? notifications.slice(0, 20).map((item) => <button type="button" className={`notification-item ${item.read ? "" : "unread"}`} key={item.id} onClick={() => openWinnerFromNotification(item)}>
                    <span className="notification-item-icon"><Trophy size={17} /></span><span className="notification-item-copy"><strong>{item.winner} won a date round!</strong><span>{item.groupName} · {formatDate(item.period_start)} – {formatDate(item.period_end)}</span><small>{formatDuration(item.seconds)} study time · {formatTime(item.createdAt)}</small></span>{!item.read && <i className="notification-unread-dot" />}
                  </button>) : <div className="notification-empty"><Bell size={22} /><strong>No announcements yet</strong><span>New group winners will appear here.</span></div>}
                </div>
              </section>}
            </div>
            <button className="icon-button" title="Refresh dashboard" aria-label="Refresh dashboard" onClick={() => { setLoading(true); void loadDashboard(); void checkRoundWinnerAnnouncements(); }} disabled={loading}><RefreshCw size={17} className={loading ? "spin" : ""} /></button>
            <div className="avatar top-avatar">{getInitials(profile.name)}</div>
          </div>
        </header>

        <div className="page-content">
          <StreakCalendar
            days={summary?.daily_study || []}
            streak={summary?.current_streak || 0}
          />
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
              <div className="session-header-actions">
                <button className="primary-button" onClick={() => { setManualSessionError(""); setShowManualSessionForm(true); }}><Plus size={16} /> Add study time</button>
                <button className="secondary-button" onClick={cleanupOldSessions}><Trash2 size={16} /> Clean up now</button>
              </div>
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
              <section className="panel page-panel winner-history winner-showcase">
                <div className="winner-showcase-heading">
                  <div className="winner-heading-icon"><Trophy size={23} /></div>
                  <div className="winner-heading-copy">
                    <span className="winner-section-kicker">THE HALL OF FAME</span>
                    <h2>Date-round champions</h2>
                    <p>Every completed date block has its own champion. Pick a card to launch the celebration.</p>
                  </div>
                  <span className="winner-total-pill"><Trophy size={13} /> {roundWinners.length} {roundWinners.length === 1 ? "winner" : "winners"}</span>
                </div>
                {roundWinners.length ? <div className="round-winner-grid">{[...roundWinners].sort((a, b) => String(b.period_start).localeCompare(String(a.period_start))).map((winner, index) => <button type="button" className={`round-winner-card ${index === 0 ? "round-winner-featured" : ""}`} key={winner.period_start} onClick={() => setSelectedRoundWinner(winner)}>
                  <span className="round-winner-card-top"><span className={`round-winner-label ${index === 0 ? "latest-label" : ""}`}>{index === 0 ? <><Sparkles size={12} /> LATEST CHAMPION</> : `ROUND ${roundWinners.length - index}`}</span><span className="round-winner-medal"><Trophy size={19} /></span></span>
                  <span className="round-winner-person"><span className="round-winner-avatar">{getInitials(winner.winner || "?")}</span><span className="round-winner-person-copy"><strong>{winner.winner || "No activity"}</strong><small>Group champion</small></span></span>
                  <span className="round-winner-date"><Clock3 size={13} /> {formatDate(winner.period_start)} <span>—</span> {formatDate(winner.period_end)}</span>
                  <span className="round-winner-card-bottom"><span className="round-winner-time-label">STUDY TIME</span><strong>{formatDuration(winner.seconds)}</strong><span className="round-winner-view">Celebrate <ArrowUpRight size={15} /></span></span>
                </button>)}</div> : <div className="winner-empty-showcase"><span className="winner-empty-icon"><Trophy size={27} /></span><span className="winner-section-kicker">THE FIRST TROPHY IS WAITING</span><h3>Your first champion is yet to be crowned</h3><p>When a date round closes, its winner will appear here. The next round starts a fresh competition for everyone.</p><div className="winner-round-track"><span>1–7</span><i /><span>8–14</span><i /><span>15–21</span><i /><span>22–end</span></div></div>}
                <div className="winner-notification-hint winner-notification-banner"><span className="winner-notification-icon"><BellRing size={19} /></span><span className="winner-notification-copy"><strong>Never miss a champion announcement</strong><small>New winners appear in your notification bell. Enable browser alerts to get a desktop notification while StudyTrack is open.</small></span><button type="button" className="winner-alerts-button" onClick={() => setShowNotificationPanel(true)}>Notification settings <ArrowUpRight size={14} /></button></div>
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

      {selectedRoundWinner && <div className="winner-celebration-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRoundWinner(null); }}>
        <section className="winner-celebration-card" role="dialog" aria-modal="true" aria-labelledby="winner-celebration-title">
          <button type="button" className="winner-celebration-close" onClick={() => setSelectedRoundWinner(null)} aria-label="Close celebration"><X size={18} /></button>
          <div className="celebration-confetti" aria-hidden="true">{Array.from({ length: 42 }, (_, index) => <i key={index} style={{ left: `${(index * 37) % 100}%`, animationDelay: `${(index % 14) * 0.075}s`, transform: `rotate(${index * 47}deg)` }} />)}</div>
          <div className="winner-celebration-glow" />
          <span className="winner-celebration-icon"><Trophy size={38} /></span>
          <span className="winner-celebration-kicker"><PartyPopper size={16} /> DATE ROUND CHAMPION</span>
          <h2 id="winner-celebration-title">Congratulations!</h2>
          <p className="winner-celebration-name">{selectedRoundWinner.winner || "No activity"}</p>
          <p className="winner-celebration-period">{formatDate(selectedRoundWinner.period_start)} – {formatDate(selectedRoundWinner.period_end)}</p>
          <div className="winner-celebration-time"><span>Winning study time</span><strong>{formatDuration(selectedRoundWinner.seconds)}</strong></div>
          <div className="winner-celebration-message"><Sparkles size={16} /> Consistency, focus, and effort deserve to be celebrated!</div>
          <button type="button" className="primary-button winner-celebration-button" onClick={() => setSelectedRoundWinner(null)}>Awesome!</button>
        </section>
      </div>}

      <style>{`
        .notification-anchor{position:relative}
        .notification-bell{position:relative}
        .notification-bell.has-unread{color:#6d5ce7}
        .notification-count{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:99px;background:#e45472;color:#fff;font-size:10px;font-weight:800;display:grid;place-items:center;border:2px solid var(--panel,#fff)}
        .notification-panel{position:absolute;z-index:80;right:0;top:calc(100% + 12px);width:min(390px,calc(100vw - 28px));background:var(--panel,#fff);border:1px solid var(--border,#e9e7f1);border-radius:18px;box-shadow:0 22px 65px #21184a24;overflow:hidden;color:var(--text,#29263a)}
        .notification-panel-heading{display:flex;align-items:center;justify-content:space-between;padding:17px 18px 12px;border-bottom:1px solid var(--border,#eeeaf5)}
        .notification-panel-heading>div{display:grid;gap:3px}.notification-panel-heading strong{font-size:15px}.notification-panel-heading span{font-size:12px;color:var(--muted,#858197)}
        .notification-settings-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 16px;background:var(--soft,#faf9fe);border-bottom:1px solid var(--border,#eeeaf5)}
        .notification-settings-row .text-button{font-size:11px;gap:5px}.notification-permission{font-size:11px;color:var(--muted,#858197)}.notification-permission.enabled{color:#23845c;display:flex;align-items:center;gap:5px}
        .notification-list{max-height:370px;overflow:auto}.notification-item{width:100%;display:flex;align-items:flex-start;gap:11px;padding:13px 15px;border:0;border-bottom:1px solid var(--border,#f0eef5);background:transparent;text-align:left;color:inherit;cursor:pointer}.notification-item:hover{background:var(--soft,#faf9fe)}.notification-item.unread{background:#f7f5ff}
        .notification-item-icon{width:34px;height:34px;flex:0 0 34px;border-radius:11px;background:#eeeaff;color:#715ce5;display:grid;place-items:center}.notification-item-copy{display:grid;gap:4px;min-width:0;flex:1}.notification-item-copy strong{font-size:12px}.notification-item-copy span,.notification-item-copy small{font-size:11px;color:var(--muted,#858197);line-height:1.4}.notification-unread-dot{width:8px;height:8px;flex:0 0 8px;margin-top:6px;border-radius:50%;background:#755fe8}
        .notification-empty{padding:30px 16px;display:grid;justify-items:center;gap:8px;color:var(--muted,#858197);text-align:center}.notification-empty strong{color:var(--text,#29263a);font-size:13px}.notification-empty span{font-size:12px}
        .winner-showcase{position:relative;overflow:hidden;border:1px solid #e9e5fa;background:radial-gradient(ellipse at 92% 0%,#f0ecff 0%,transparent 34%),var(--panel,#fff)}
        .winner-showcase-heading{display:flex;align-items:center;gap:15px;margin-bottom:23px}.winner-heading-icon{width:52px;height:52px;flex:0 0 52px;border-radius:17px;display:grid;place-items:center;color:#a87817;background:linear-gradient(145deg,#fff4cf,#f9e6a5);box-shadow:inset 0 0 0 1px #efd78c}.winner-heading-copy{min-width:0;flex:1}.winner-section-kicker{display:block;color:#8970cf;font-size:9px;font-weight:850;letter-spacing:1.8px;margin-bottom:5px}.winner-heading-copy h2{margin:0 0 5px;font-size:21px;letter-spacing:-.5px}.winner-heading-copy p{margin:0;color:var(--muted,#858197);font-size:12px;line-height:1.5}.winner-total-pill{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;padding:8px 11px;border:1px solid #e9e3fb;border-radius:99px;background:#faf8ff;color:#6e59bd;font-size:11px;font-weight:750}
        .round-winner-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.round-winner-card{position:relative;isolation:isolate;min-width:0;overflow:hidden;display:flex;flex-direction:column;gap:15px;padding:17px;border:1px solid #eae7f2;border-radius:19px;background:linear-gradient(145deg,#fff 0%,#fbfaff 100%);color:var(--text,#29263a);text-align:left;cursor:pointer;box-shadow:0 3px 12px #28204b08;transition:transform .22s ease,box-shadow .22s ease,border-color .22s ease}.round-winner-card:before{content:"";position:absolute;z-index:-1;width:150px;height:150px;right:-70px;top:-85px;border-radius:50%;background:#eee9ff;opacity:.75;transition:transform .35s ease}.round-winner-card:hover{transform:translateY(-5px);border-color:#cfc3f5;box-shadow:0 15px 32px #39266e16}.round-winner-card:hover:before{transform:scale(1.35)}.round-winner-featured{border-color:#ead79a;background:linear-gradient(145deg,#fffdf5 0%,#fff 72%,#fff9e8 100%);box-shadow:0 5px 18px #9c76100c}.round-winner-featured:before{background:#ffefc4}.round-winner-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.round-winner-label{display:inline-flex;align-items:center;gap:5px;color:#8b849e;font-size:9px;font-weight:850;letter-spacing:1.25px}.round-winner-label.latest-label{color:#a57616}.round-winner-medal{width:34px;height:34px;display:grid;place-items:center;border-radius:12px;background:#f0edff;color:#8168d2}.round-winner-featured .round-winner-medal{background:#ffedb8;color:#a97813;box-shadow:0 4px 12px #d7aa3b25}.round-winner-person{display:flex;align-items:center;gap:11px}.round-winner-avatar{width:43px;height:43px;flex:0 0 43px;display:grid;place-items:center;border-radius:15px;background:linear-gradient(145deg,#8872e6,#5d4bb9);color:white;font-size:14px;font-weight:850;box-shadow:0 5px 12px #6550bd30}.round-winner-featured .round-winner-avatar{background:linear-gradient(145deg,#e6b94f,#bd8525);box-shadow:0 5px 13px #c28e2d35}.round-winner-person-copy{display:grid;gap:3px;min-width:0}.round-winner-person-copy strong{font-size:16px;font-weight:850;overflow-wrap:anywhere}.round-winner-person-copy small{font-size:10px;color:var(--muted,#858197)}.round-winner-date{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:#77738a;font-size:11px}.round-winner-date svg{color:#9a8bc9}.round-winner-card-bottom{display:flex;align-items:flex-end;gap:8px;margin-top:1px;padding-top:13px;border-top:1px solid #efedf5}.round-winner-time-label{align-self:center;margin-right:auto;color:#9993a8;font-size:8px;font-weight:850;letter-spacing:1.1px}.round-winner-card-bottom>strong{color:#4f438b;font-size:17px;font-weight:850;font-variant-numeric:tabular-nums}.round-winner-featured .round-winner-card-bottom>strong{color:#9a6d14}.round-winner-view{display:inline-flex;align-items:center;gap:3px;margin-left:auto;color:#8069ce;font-size:10px;font-weight:800;white-space:nowrap}.round-winner-featured .round-winner-view{color:#a57616}
        .winner-empty-showcase{display:grid;justify-items:center;text-align:center;padding:29px 20px 27px;border:1px dashed #dcd5ef;border-radius:19px;background:linear-gradient(145deg,#fbfaff,#fff)}.winner-empty-icon{width:62px;height:62px;display:grid;place-items:center;margin-bottom:15px;border-radius:20px;background:linear-gradient(145deg,#fff1c8,#f8e5a4);color:#aa7c1c;box-shadow:0 8px 20px #c69b3420}.winner-empty-showcase h3{margin:7px 0;color:var(--text,#29263a);font-size:17px}.winner-empty-showcase p{max-width:430px;margin:0;color:var(--muted,#858197);font-size:12px;line-height:1.6}.winner-round-track{display:flex;align-items:center;gap:8px;margin-top:20px}.winner-round-track span{padding:7px 10px;border-radius:9px;background:#f0edff;color:#7663bd;font-size:10px;font-weight:800}.winner-round-track i{width:13px;height:1px;background:#d7d0eb}
        .winner-notification-hint{display:flex;align-items:center;gap:12px;margin-top:18px;padding:15px;border-radius:16px;background:linear-gradient(110deg,#f4f1ff,#f8f7ff);color:#6255a4;font-size:12px;line-height:1.5}.winner-notification-icon{width:39px;height:39px;flex:0 0 39px;display:grid;place-items:center;border-radius:13px;background:#e8e1ff;color:#725bd0}.winner-notification-copy{display:grid;gap:3px;flex:1;min-width:0}.winner-notification-copy strong{font-size:12px;color:#51428e}.winner-notification-copy small{font-size:10px;color:#77709a;line-height:1.5}.winner-alerts-button{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;border:0;border-radius:10px;padding:9px 11px;background:#6d58c5;color:white;font-size:10px;font-weight:750;cursor:pointer;transition:background .18s ease,transform .18s ease}.winner-alerts-button:hover{background:#5844ad;transform:translateY(-1px)}
        .winner-celebration-backdrop{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:20px;background:rgba(20,16,42,.72);backdrop-filter:blur(9px);animation:celebrationFadeIn .22s ease-out}
        .winner-celebration-card{position:relative;isolation:isolate;overflow:hidden;width:min(470px,100%);padding:38px 30px 30px;border-radius:28px;background:linear-gradient(155deg,#211b49 0%,#33236b 55%,#4d3287 100%);color:#fff;text-align:center;box-shadow:0 28px 90px #08051b88;animation:championPop .55s cubic-bezier(.18,.85,.25,1.18) both}
        .winner-celebration-close{position:absolute;z-index:5;right:14px;top:14px;width:34px;height:34px;border:1px solid #ffffff30;border-radius:50%;background:#ffffff12;color:#fff;display:grid;place-items:center;cursor:pointer}
        .winner-celebration-glow{position:absolute;z-index:-1;width:260px;height:260px;left:50%;top:-135px;transform:translateX(-50%);border-radius:50%;background:#f3c85d38;filter:blur(28px);animation:glowPulse 2.2s ease-in-out infinite}
        .winner-celebration-icon{width:82px;height:82px;margin:0 auto 17px;border-radius:26px;display:grid;place-items:center;color:#ffdb78;background:linear-gradient(145deg,#fff1bb25,#f0bd4b30);border:1px solid #ffdf8b70;box-shadow:0 0 45px #f3c85d36;animation:trophyFloat 2.4s ease-in-out infinite}
        .winner-celebration-kicker{display:inline-flex;align-items:center;gap:7px;color:#f8d989;font-size:11px;font-weight:800;letter-spacing:2px}.winner-celebration-card h2{margin:13px 0 5px;font-size:27px;color:#fff}.winner-celebration-name{margin:0;font-size:30px;font-weight:850;letter-spacing:-.8px;color:#fff}.winner-celebration-period{margin:9px 0 20px;color:#d6ccef;font-size:13px}
        .winner-celebration-time{display:grid;gap:6px;padding:15px;border-radius:17px;background:#ffffff12;border:1px solid #ffffff20}.winner-celebration-time span{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#d8ccef}.winner-celebration-time strong{font-size:27px;color:#ffdf8c;font-variant-numeric:tabular-nums}.winner-celebration-message{display:flex;justify-content:center;align-items:center;gap:7px;margin:18px 0;color:#e7dcff;font-size:12px}.winner-celebration-message svg{color:#ffdb78}.winner-celebration-button{min-width:145px;justify-content:center;background:#f6d477!important;color:#2b214d!important;border:0!important;font-weight:800}
        .celebration-confetti{position:absolute;inset:0;z-index:-1;overflow:hidden;pointer-events:none}.celebration-confetti i{position:absolute;top:-18px;width:8px;height:13px;border-radius:2px;background:#f6d477;animation:confettiFall 2.8s cubic-bezier(.2,.65,.3,1) infinite;opacity:0}.celebration-confetti i:nth-child(3n){background:#e58acb;width:6px;height:10px}.celebration-confetti i:nth-child(3n + 1){background:#8fe2d1;width:7px;height:12px}.celebration-confetti i:nth-child(4n){border-radius:50%;background:#fff1bb;width:6px;height:6px}
        @keyframes celebrationFadeIn{from{opacity:0}to{opacity:1}}@keyframes championPop{0%{opacity:0;transform:translateY(24px) scale(.88)}100%{opacity:1;transform:translateY(0) scale(1)}}@keyframes trophyFloat{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-8px) rotate(3deg)}}@keyframes glowPulse{0%,100%{opacity:.55;transform:translateX(-50%) scale(.9)}50%{opacity:1;transform:translateX(-50%) scale(1.12)}}@keyframes confettiFall{0%{opacity:0;transform:translateY(-20px) rotate(0deg)}12%{opacity:1}100%{opacity:0;transform:translateY(470px) rotate(680deg)}}
        @media(max-width:700px){.round-winner-grid{grid-template-columns:1fr}.winner-total-pill{align-self:flex-start}.winner-showcase-heading{align-items:flex-start;flex-wrap:wrap}.winner-notification-banner{align-items:flex-start;flex-wrap:wrap}.winner-alerts-button{margin-left:51px}}
        @media(max-width:600px){.notification-panel{right:-52px}.winner-celebration-card{padding:34px 20px 24px}.winner-celebration-name{font-size:25px}.winner-showcase-heading{gap:11px}.winner-heading-icon{width:44px;height:44px;flex-basis:44px;border-radius:14px}.winner-heading-copy h2{font-size:19px}.winner-alerts-button{margin-left:0}.winner-round-track{gap:5px}.winner-round-track span{padding:6px 7px;font-size:9px}}
        @media(prefers-reduced-motion:reduce){.winner-celebration-backdrop,.winner-celebration-card,.winner-celebration-icon,.winner-celebration-glow,.celebration-confetti i{animation:none!important}.winner-row-clickable{transition:none}}
      `}</style>

      {showManualSessionForm && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setShowManualSessionForm(false); }}>
        <section className="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="manual-session-title">
          <div className="modal-header">
            <div><span className="modal-kicker">MANUAL STUDY LOG</span><h2 id="manual-session-title">Add study time</h2><p>Record learning you did away from tracked browser websites.</p></div>
            <button className="icon-button" onClick={() => !saving && setShowManualSessionForm(false)} aria-label="Close" disabled={saving}><X size={18} /></button>
          </div>
          <form onSubmit={submitManualSession} className="modal-form">
            <label htmlFor="manual-topic">Topic</label>
            <select id="manual-topic" value={manualSession.topic} onChange={(e) => setManualSession({ ...manualSession, topic: e.target.value, domain: "" })}>
              <option value="">General</option>
              {topics.map((topic) => <option key={topic.id} value={topic.name}>{topic.name}</option>)}
            </select>
            <label htmlFor="manual-domain">Domain</label>
            <select id="manual-domain" value={manualSession.domain} disabled={!manualSession.topic} onChange={(e) => setManualSession({ ...manualSession, domain: e.target.value })}>
              <option value="">General</option>
              {(topics.find((topic) => topic.name === manualSession.topic)?.domains || []).map((domain) => <option key={domain.id} value={domain.name}>{domain.name}</option>)}
            </select>
            {!manualSession.topic && <p className="form-hint">Select a topic first to choose or create its domain.</p>}
            {manualSession.topic && !showManualDomainForm && <button type="button" className="text-button manual-create-domain" onClick={() => { setManualDomainError(""); setShowManualDomainForm(true); }}><Plus size={15} /> Create domain</button>}
            {showManualDomainForm && <form className="domain-form manual-domain-form" onSubmit={submitManualDomain}>
              <input autoFocus required maxLength={100} value={manualDomainName} placeholder="Enter new domain name" onChange={(e) => setManualDomainName(e.target.value)} />
              <button type="submit" className="primary-button" disabled={saving || !manualDomainName.trim()}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Add</button>
              <button type="button" className="icon-button" disabled={saving} onClick={() => { setShowManualDomainForm(false); setManualDomainName(""); setManualDomainError(""); }} aria-label="Cancel creating domain"><X size={15} /></button>
            </form>}
            {manualDomainError && <div className="alert alert-error">{manualDomainError}</div>}
            <label htmlFor="manual-activity">What did you study? (optional)</label>
            <input id="manual-activity" maxLength={500} placeholder="e.g. Solved heap problems / watched a lecture" value={manualSession.activity} onChange={(e) => setManualSession({ ...manualSession, activity: e.target.value })} />
            <div className="manual-session-grid">
              <div><label htmlFor="manual-date">Study date</label><input id="manual-date" type="date" min={getTodayDate()} max={getTodayDate()} required value={manualSession.date} onChange={(e) => setManualSession({ ...manualSession, date: e.target.value })} /></div>
              <div><label htmlFor="manual-start">Start time</label><input id="manual-start" type="time" required value={manualSession.startTime} onChange={(e) => setManualSession({ ...manualSession, startTime: e.target.value })} /></div>
            </div>
            <label>Duration</label>
            <div className="manual-session-grid duration-grid">
              <div><label htmlFor="manual-hours">Hours</label><input id="manual-hours" type="number" min="0" max="24" step="1" required value={manualSession.hours} onChange={(e) => setManualSession({ ...manualSession, hours: e.target.value })} /></div>
              <div><label htmlFor="manual-minutes">Minutes</label><input id="manual-minutes" type="number" min="0" max="59" step="1" required value={manualSession.minutes} onChange={(e) => setManualSession({ ...manualSession, minutes: e.target.value })} /></div>
            </div>
            {manualSessionError && <div className="alert alert-error">{manualSessionError}</div>}
            <div className="modal-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => setShowManualSessionForm(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Clock3 size={17} />} Save study time</button></div>
          </form>
        </section>
      </div>}

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
