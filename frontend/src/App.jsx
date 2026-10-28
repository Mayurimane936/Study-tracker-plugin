
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Code2,
  FileText,
  Flame,
  FolderOpen,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Target,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const API_URL = "http://127.0.0.1:8000";

const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "sessions", label: "Study sessions", icon: Clock3 },
  { id: "notes", label: "My notes", icon: FileText },
  { id: "topics", label: "Topics", icon: FolderOpen },
];

function formatDuration(seconds = 0) {
  const totalSeconds = Math.floor(Math.max(0, Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  if (minutes > 0 && remainingSeconds > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${remainingSeconds}s`;
}

function formatDate(value) {
  if (!value) return "Date unavailable";

  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(value) {
  if (!value) return "—";

  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getInitials(value = "StudyTrack") {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function StatCard({ title, value, subtitle, icon: Icon, tone }) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span className={`stat-icon ${tone}`}>
          <Icon size={20} />
        </span>
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
      <span className="empty-icon">
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState("overview");
  const [summary, setSummary] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [notes, setNotes] = useState([]);
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [noteForm, setNoteForm] = useState({
    title: "",
    content: "",
    topic_id: "",
  });
  const [topicName, setTopicName] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const endpoints = [
        "/dashboard/summary",
        "/sessions?limit=100",
        "/notes",
        "/topics",
      ];

      const responses = await Promise.all(
        endpoints.map((endpoint) =>
          fetch(`${API_URL}${endpoint}`)
        )
      );

      const failedResponse = responses.find((response) => !response.ok);

      if (failedResponse) {
        throw new Error(
          `API request failed (${failedResponse.status}). Check that your backend is running.`
        );
      }

      const [summaryData, sessionData, noteData, topicData] =
        await Promise.all(responses.map((response) => response.json()));

      setSummary(summaryData);
      setSessions(sessionData);
      setNotes(noteData);
      setTopics(topicData);
    } catch (err) {
      setError(
        err.message ||
          "Couldn't connect to StudyTrack. Make sure the FastAPI backend is running."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const topicMap = Object.fromEntries(
    topics.map((topic) => [topic.id, topic.name])
  );

  const filteredSessions = sessions.filter((session) => {
    const searchText = search.toLowerCase();
    return (
      (session.subject || "").toLowerCase().includes(searchText) ||
      (session.site_title || "").toLowerCase().includes(searchText) ||
      (session.site_url || "").toLowerCase().includes(searchText)
    );
  });

  const filteredNotes = notes.filter((note) => {
    const searchText = search.toLowerCase();
    return (
      (note.title || "").toLowerCase().includes(searchText) ||
      (note.content || "").toLowerCase().includes(searchText) ||
      (topicMap[note.topic_id] || "").toLowerCase().includes(searchText)
    );
  });

  const weeklyData = (summary?.weekly_study || []).map((day) => ({
    day: new Date(`${day.date}T12:00:00`).toLocaleDateString("en-IN", {
      weekday: "short",
    }),
    date: day.date,
    hours: Number((day.seconds / 3600).toFixed(2)),
  }));

  const todayLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  async function submitTopic(event) {
    event.preventDefault();

    const name = topicName.trim();
    if (!name) return;

    setSaving(true);
    setNotice("");
    setError("");

    try {
      const response = await fetch(`${API_URL}/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Couldn't create the topic."
        );
      }

      setTopicName("");
      setShowTopicForm(false);
      setNotice("Topic created successfully.");
      await loadDashboard();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitNote(event) {
    event.preventDefault();

    if (!noteForm.title.trim()) return;

    setSaving(true);
    setNotice("");
    setError("");

    try {
      const response = await fetch(`${API_URL}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: noteForm.title.trim(),
          content: noteForm.content,
          topic_id: noteForm.topic_id
            ? Number(noteForm.topic_id)
            : null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Couldn't save the note."
        );
      }

      setNoteForm({ title: "", content: "", topic_id: "" });
      setShowNoteForm(false);
      setNotice("Note saved successfully.");
      await loadDashboard();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const pageTitles = {
    overview: ["Your study space", "Here's how your learning is going."],
    sessions: ["Study sessions", "Review the time you've spent learning."],
    notes: ["My notes", "Keep your learning and ideas in one place."],
    topics: ["Your topics", "Organize your learning by subject."],
  };

  const [pageTitle, pageSubtitle] = pageTitles[activePage];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <BookOpen size={23} />
          </div>
          <div>
            <span className="brand-name">studytrack</span>
            <span className="brand-caption">YOUR LEARNING SPACE</span>
          </div>
        </div>

        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="navigation" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item ${activePage === id ? "active" : ""}`}
              key={id}
              onClick={() => {
                setActivePage(id);
                setSearch("");
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "notes" && notes.length > 0 && (
                <span className="nav-count">{notes.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="focus-card">
            <div className="focus-card-icon">
              <Flame size={18} />
            </div>
            <p className="focus-title">Small steps add up.</p>
            <p className="focus-description">
              Every focused minute moves you forward.
            </p>
            <div className="focus-progress">
              <span />
            </div>
            <div className="focus-footer">
              <span>Keep learning</span>
              <Target size={15} />
            </div>
          </div>
          <div className="profile">
            <div className="avatar">S</div>
            <div className="profile-info">
              <strong>My workspace</strong>
              <span>Personal study tracker</span>
            </div>
            <ChevronDown size={16} className="profile-chevron" />
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="breadcrumb-separator">/</span>
            <strong>
              {navigation.find((item) => item.id === activePage)?.label}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="connection-status">
              <span className={`status-dot ${error ? "offline" : ""}`} />
              {error ? "Connection issue" : "StudyTrack API"}
            </span>
            <button
              className="icon-button"
              title="Refresh dashboard"
              aria-label="Refresh dashboard"
              onClick={loadDashboard}
              disabled={loading}
            >
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </button>
            <div className="avatar top-avatar">S</div>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-dot" />
                YOUR PERSONAL LEARNING DASHBOARD
              </div>
              <h1>{pageTitle}</h1>
              <p className="page-subtitle">{pageSubtitle}</p>
            </div>
            <div className="date-chip">
              <Clock3 size={16} />
              {todayLabel}
            </div>
          </section>

          {error && (
            <div className="alert alert-error">
              <span>{error}</span>
              <button onClick={loadDashboard} className="alert-action">
                Retry
              </button>
            </div>
          )}

          {notice && (
            <div className="alert alert-success">
              <Check size={17} />
              <span>{notice}</span>
              <button
                className="alert-dismiss"
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {activePage === "overview" && (
            <>
              <section className="stats-grid">
                <StatCard
                  title="Total study time"
                  value={
                    loading && !summary
                      ? "—"
                      : formatDuration(summary?.total_study_seconds)
                  }
                  subtitle="Across all recorded sessions"
                  icon={Clock3}
                  tone="purple"
                />
                <StatCard
                  title="Study sessions"
                  value={summary?.sessions_count ?? "—"}
                  subtitle="Sessions recorded so far"
                  icon={Activity}
                  tone="blue"
                />
                <StatCard
                  title="Notes collected"
                  value={summary?.notes_count ?? "—"}
                  subtitle="Ideas saved for later"
                  icon={FileText}
                  tone="orange"
                />
                <StatCard
                  title="Learning topics"
                  value={summary?.topics_count ?? "—"}
                  subtitle="Subjects you're exploring"
                  icon={FolderOpen}
                  tone="green"
                />
              </section>

              <section className="dashboard-grid">
                <article className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Your study rhythm</h2>
                      <p>Daily study time over the last 7 days</p>
                    </div>
                    <span className="panel-badge">THIS WEEK</span>
                  </div>

                  <div className="chart-legend">
                    <span className="legend-dot" />
                    <span>Study hours</span>
                  </div>

                  <div className="chart-container">
                    {weeklyData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={weeklyData}
                          margin={{
                            top: 12,
                            right: 8,
                            left: -20,
                            bottom: 0,
                          }}
                          barSize={28}
                        >
                          <CartesianGrid
                            strokeDasharray="3 5"
                            vertical={false}
                            stroke="#ececf3"
                          />
                          <XAxis
                            dataKey="day"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: "#9292a5", fontSize: 12 }}
                            dy={10}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: "#9292a5", fontSize: 11 }}
                            tickFormatter={(value) => `${value}h`}
                          />
                          <Tooltip
                            cursor={{ fill: "#f5f3ff" }}
                            formatter={(value) => [
                              `${value} hours`,
                              "Study time",
                            ]}
                            labelFormatter={(_, payload) =>
                              payload?.[0]?.payload?.date || ""
                            }
                            contentStyle={{
                              borderRadius: 12,
                              border: "1px solid #eeeaf9",
                              boxShadow: "0 8px 24px #29205b12",
                            }}
                          />
                          <Bar
                            dataKey="hours"
                            fill="#7661e8"
                            radius={[7, 7, 2, 2]}
                            minPointSize={3}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <EmptyState
                        icon={Activity}
                        title="Your study rhythm starts here"
                        description="Record a study session to see your weekly progress."
                      />
                    )}
                  </div>
                </article>

                <article className="panel today-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Today's focus</h2>
                      <p>Your progress for today</p>
                    </div>
                    <span className="today-icon">
                      <Target size={19} />
                    </span>
                  </div>

                  <div className="today-time">
                    {formatDuration(summary?.today_study_seconds)}
                  </div>
                  <p className="today-caption">Study time recorded today</p>

                  <div className="today-divider" />

                  <div className="today-metric">
                    <span className="today-metric-icon purple-soft">
                      <ArrowUpRight size={17} />
                    </span>
                    <div>
                      <strong>{summary?.sessions_count ?? 0}</strong>
                      <span>Total sessions</span>
                    </div>
                  </div>
                  <div className="today-metric">
                    <span className="today-metric-icon green-soft">
                      <Check size={17} />
                    </span>
                    <div>
                      <strong>{summary?.topics_count ?? 0}</strong>
                      <span>Topics to explore</span>
                    </div>
                  </div>

                  <div className="encouragement">
                    <Flame size={17} />
                    <span>Consistency matters more than perfection.</span>
                  </div>
                </article>
              </section>

              <section className="panel recent-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Recent study sessions</h2>
                    <p>A quick look at your latest learning activity</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setActivePage("sessions")}
                  >
                    View all <ArrowUpRight size={15} />
                  </button>
                </div>
                <SessionTable
                  sessions={sessions.slice(0, 5)}
                  topicMap={topicMap}
                  loading={loading}
                />
              </section>

              <section className="bottom-grid">
                <article className="panel compact-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Recently saved notes</h2>
                      <p>Ideas worth remembering</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setActivePage("notes")}
                    >
                      View all <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {notes.length === 0 ? (
                    <EmptyState
                      icon={FileText}
                      title="No notes yet"
                      description="Save an idea and it'll show up here."
                    />
                  ) : (
                    <div className="mini-list">
                      {notes.slice(0, 3).map((note) => (
                        <div className="mini-item" key={note.id}>
                          <span className="mini-item-icon">
                            <FileText size={17} />
                          </span>
                          <div className="mini-item-content">
                            <strong>{note.title}</strong>
                            <span>
                              {topicMap[note.topic_id] || "General"} ·{" "}
                              {formatDate(note.updated_at)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </article>

                <article className="panel compact-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Your learning topics</h2>
                      <p>What you're working on</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setActivePage("topics")}
                    >
                      View all <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {topics.length === 0 ? (
                    <EmptyState
                      icon={FolderOpen}
                      title="No topics yet"
                      description="Create a topic to organize your notes."
                    />
                  ) : (
                    <div className="topic-chips">
                      {topics.slice(0, 8).map((topic, index) => (
                        <span
                          className={`topic-chip topic-color-${index % 4}`}
                          key={topic.id}
                        >
                          <span />
                          {topic.name}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              </section>
            </>
          )}

          {activePage === "sessions" && (
            <section className="panel page-panel">
              <div className="panel-heading page-panel-heading">
                <div>
                  <h2>All study sessions</h2>
                  <p>{sessions.length} sessions recorded in your workspace</p>
                </div>
              </div>
              <SearchBox value={search} onChange={setSearch} />
              <SessionTable
                sessions={filteredSessions}
                topicMap={topicMap}
                loading={loading}
              />
            </section>
          )}

          {activePage === "notes" && (
            <section className="panel page-panel">
              <div className="panel-heading page-panel-heading">
                <div>
                  <h2>Your notes library</h2>
                  <p>Save concepts, summaries, and useful ideas.</p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setShowNoteForm(true)}
                >
                  <Plus size={17} /> New note
                </button>
              </div>

              <SearchBox value={search} onChange={setSearch} />

              {filteredNotes.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No matching notes"
                  description="Create a note or try another search."
                />
              ) : (
                <div className="notes-grid">
                  {filteredNotes.map((note) => (
                    <article className="note-card" key={note.id}>
                      <div className="note-card-top">
                        <span className="note-card-icon">
                          <FileText size={18} />
                        </span>
                        <span className="note-date">
                          {formatDate(note.updated_at)}
                        </span>
                      </div>
                      <h3>{note.title}</h3>
                      <p className="note-preview">
                        {note.content || "No additional content."}
                      </p>
                      <div className="note-card-footer">
                        <span className="note-topic">
                          {topicMap[note.topic_id] || "General"}
                        </span>
                        <span className="note-id">NOTE-{note.id}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {activePage === "topics" && (
            <section className="panel page-panel">
              <div className="panel-heading page-panel-heading">
                <div>
                  <h2>Learning topics</h2>
                  <p>Organize notes around what you're learning.</p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setShowTopicForm(true)}
                >
                  <Plus size={17} /> New topic
                </button>
              </div>

              {topics.length === 0 ? (
                <EmptyState
                  icon={FolderOpen}
                  title="Your topics start here"
                  description="Create topics like DSA, system design, or backend development."
                />
              ) : (
                <div className="topics-grid">
                  {topics.map((topic, index) => {
                    const topicNotes = notes.filter(
                      (note) => note.topic_id === topic.id
                    ).length;
                    const topicSessions = sessions.filter(
                      (session) => session.topic_id === topic.id
                    ).length;

                    return (
                      <article className="topic-card" key={topic.id}>
                        <div className={`topic-card-icon topic-color-${index % 4}`}>
                          {index % 2 === 0 ? (
                            <BookOpen size={21} />
                          ) : (
                            <Code2 size={21} />
                          )}
                        </div>
                        <h3>{topic.name}</h3>
                        <p>Created {formatDate(topic.created_at)}</p>
                        <div className="topic-card-stats">
                          <span>{topicNotes} notes</span>
                          <span>{topicSessions} sessions</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <footer className="page-footer">
            <span>Made for focused learning.</span>
            <span>
              <span className="footer-dot" /> StudyTrack · Personal workspace
            </span>
          </footer>
        </div>
      </main>

      {showNoteForm && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowNoteForm(false);
            }
          }}
        >
          <section className="modal" role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <span className="modal-kicker">YOUR KNOWLEDGE LIBRARY</span>
                <h2>Create a note</h2>
                <p>Capture something you want to remember.</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowNoteForm(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitNote} className="modal-form">
              <label htmlFor="note-title">Title</label>
              <input
                id="note-title"
                autoFocus
                required
                maxLength={200}
                placeholder="e.g. Binary search — key idea"
                value={noteForm.title}
                onChange={(event) =>
                  setNoteForm({ ...noteForm, title: event.target.value })
                }
              />

              <label htmlFor="note-topic">Topic</label>
              <select
                id="note-topic"
                value={noteForm.topic_id}
                onChange={(event) =>
                  setNoteForm({ ...noteForm, topic_id: event.target.value })
                }
              >
                <option value="">General / no topic</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>

              <label htmlFor="note-content">Your notes</label>
              <textarea
                id="note-content"
                rows={6}
                placeholder="Write down the important points..."
                value={noteForm.content}
                onChange={(event) =>
                  setNoteForm({ ...noteForm, content: event.target.value })
                }
              />

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowNoteForm(false)}
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={saving}>
                  {saving ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Plus size={17} />
                  )}
                  Save note
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showTopicForm && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowTopicForm(false);
            }
          }}
        >
          <section className="modal modal-small" role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <span className="modal-kicker">ORGANIZE YOUR LEARNING</span>
                <h2>Create a topic</h2>
                <p>Give your next learning goal a name.</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowTopicForm(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitTopic} className="modal-form">
              <label htmlFor="topic-name">Topic name</label>
              <input
                id="topic-name"
                autoFocus
                required
                maxLength={100}
                placeholder="e.g. Data Structures"
                value={topicName}
                onChange={(event) => setTopicName(event.target.value)}
              />
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowTopicForm(false)}
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={saving}>
                  {saving ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Plus size={17} />
                  )}
                  Create topic
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function SearchBox({ value, onChange }) {
  return (
    <div className="search-box">
      <Search size={17} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search..."
        aria-label="Search"
      />
      {value && (
        <button
          className="search-clear"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

function SessionTable({ sessions, topicMap, loading }) {
  if (loading && sessions.length === 0) {
    return (
      <div className="table-loading">
        <LoaderCircle className="spin" size={22} />
        Loading sessions...
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={Clock3}
        title="No study sessions yet"
        description="Your saved sessions will appear here when they're recorded."
      />
    );
  }

  return (
    <div className="table-scroll">
      <table className="sessions-table">
        <thead>
          <tr>
            <th>SUBJECT / WEBSITE</th>
            <th>TOPIC</th>
            <th>DATE</th>
            <th>STARTED</th>
            <th>DURATION</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id}>
              <td>
                <div className="session-name-cell">
                  <span className="session-icon">
                    <BookOpen size={16} />
                  </span>
                  <div>
                    <strong>{session.subject || "General"}</strong>
                    <span>
                      {session.site_title ||
                        session.site_url ||
                        "Study session"}
                    </span>
                  </div>
                </div>
              </td>
              <td>
                <span className="table-topic">
                  {topicMap[session.topic_id] || "General"}
                </span>
              </td>
              <td>{formatDate(session.started_at)}</td>
              <td>{formatTime(session.started_at)}</td>
              <td>
                <strong className="duration-value">
                  {formatDuration(session.duration_seconds)}
                </strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
