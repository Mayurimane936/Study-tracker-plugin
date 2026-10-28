
import os
from datetime import date, datetime, time, timedelta, timezone
from typing import Generator, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    func,
    select,
    text,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    sessionmaker,
)

# --------------------------------------------------
# Configuration
# --------------------------------------------------

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is missing. Add it to your backend/.env file."
    )

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
)


# --------------------------------------------------
# Database models
# --------------------------------------------------

class Base(DeclarativeBase):
    pass


class Topic(Base):
    __tablename__ = "topics"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class StudySession(Base):
    __tablename__ = "study_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    subject: Mapped[str] = mapped_column(
        String(100), default="General"
    )
    duration_seconds: Mapped[int] = mapped_column(
        Integer, default=0
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    site_url: Mapped[Optional[str]] = mapped_column(
        String(2048), nullable=True
    )
    site_title: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )
    topic_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("topics.id", ondelete="SET NULL"),
        nullable=True,
    )


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text, default="")
    topic_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("topics.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


# Create missing tables without deleting existing data.
Base.metadata.create_all(bind=engine)


# --------------------------------------------------
# API schemas
# --------------------------------------------------

class TopicCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class TopicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: datetime


class StudySessionCreate(BaseModel):
    subject: str = Field(default="General", max_length=100)
    duration_seconds: int = Field(default=0, ge=0)
    started_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    ended_at: Optional[datetime] = None
    site_url: Optional[str] = Field(default=None, max_length=2048)
    site_title: Optional[str] = Field(default=None, max_length=500)
    topic_id: Optional[int] = None


class StudySessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    subject: str
    duration_seconds: int
    started_at: datetime
    ended_at: Optional[datetime]
    site_url: Optional[str]
    site_title: Optional[str]
    topic_id: Optional[int]


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = ""
    topic_id: Optional[int] = None


class NoteUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str
    topic_id: Optional[int] = None


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    content: str
    topic_id: Optional[int]
    created_at: datetime
    updated_at: datetime


# --------------------------------------------------
# FastAPI application
# --------------------------------------------------

app = FastAPI(
    title="StudyTrack API",
    description="Backend for the StudyTrack browser extension and dashboard.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def verify_topic(db: Session, topic_id: Optional[int]) -> None:
    if topic_id is not None:
        topic = db.get(Topic, topic_id)
        if topic is None:
            raise HTTPException(
                status_code=404,
                detail="Topic not found.",
            )


def normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# --------------------------------------------------
# Health checks
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "message": "Welcome to StudyTrack!",
        "status": "running",
    }


@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "healthy", "database": "connected"}
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Database connection failed.",
        )


# --------------------------------------------------
# Topics API
# --------------------------------------------------

@app.post("/topics", response_model=TopicOut, status_code=201)
def create_topic(data: TopicCreate, db: Session = Depends(get_db)):
    name = data.name.strip()

    if not name:
        raise HTTPException(422, "Topic name cannot be empty.")

    existing = db.scalar(
        select(Topic).where(func.lower(Topic.name) == name.lower())
    )
    if existing:
        raise HTTPException(409, "This topic already exists.")

    topic = Topic(name=name)
    db.add(topic)
    db.commit()
    db.refresh(topic)
    return topic


@app.get("/topics", response_model=list[TopicOut])
def get_topics(db: Session = Depends(get_db)):
    return db.scalars(select(Topic).order_by(Topic.name)).all()


# --------------------------------------------------
# Study sessions API
# --------------------------------------------------

@app.post(
    "/sessions",
    response_model=StudySessionOut,
    status_code=201,
)
def create_session(
    data: StudySessionCreate,
    db: Session = Depends(get_db),
):
    verify_topic(db, data.topic_id)

    session = StudySession(
        subject=data.subject.strip() or "General",
        duration_seconds=data.duration_seconds,
        started_at=normalize_datetime(data.started_at),
        ended_at=(
            normalize_datetime(data.ended_at)
            if data.ended_at else None
        ),
        site_url=data.site_url,
        site_title=data.site_title,
        topic_id=data.topic_id,
    )

    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@app.get("/sessions", response_model=list[StudySessionOut])
def get_sessions(
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
):
    statement = (
        select(StudySession)
        .order_by(StudySession.started_at.desc())
        .limit(limit)
    )
    return db.scalars(statement).all()


# --------------------------------------------------
# Notes API
# --------------------------------------------------

@app.post("/notes", response_model=NoteOut, status_code=201)
def create_note(data: NoteCreate, db: Session = Depends(get_db)):
    verify_topic(db, data.topic_id)

    note = Note(
        title=data.title.strip(),
        content=data.content,
        topic_id=data.topic_id,
    )

    if not note.title:
        raise HTTPException(422, "Note title cannot be empty.")

    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@app.get("/notes", response_model=list[NoteOut])
def get_notes(db: Session = Depends(get_db)):
    statement = select(Note).order_by(Note.updated_at.desc())
    return db.scalars(statement).all()


@app.put("/notes/{note_id}", response_model=NoteOut)
def update_note(
    note_id: int,
    data: NoteUpdate,
    db: Session = Depends(get_db),
):
    note = db.get(Note, note_id)

    if note is None:
        raise HTTPException(404, "Note not found.")

    verify_topic(db, data.topic_id)

    title = data.title.strip()
    if not title:
        raise HTTPException(422, "Note title cannot be empty.")

    note.title = title
    note.content = data.content
    note.topic_id = data.topic_id
    note.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(note)
    return note


@app.delete("/notes/{note_id}")
def delete_note(note_id: int, db: Session = Depends(get_db)):
    note = db.get(Note, note_id)

    if note is None:
        raise HTTPException(404, "Note not found.")

    db.delete(note)
    db.commit()
    return {"message": "Note deleted successfully."}


# --------------------------------------------------
# Dashboard analytics API
# --------------------------------------------------

@app.get("/dashboard/summary")
def dashboard_summary(db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    today = now.date()
    week_start = today - timedelta(days=6)

    total_seconds = db.scalar(
        select(func.coalesce(func.sum(StudySession.duration_seconds), 0))
    ) or 0

    sessions_count = db.scalar(
        select(func.count()).select_from(StudySession)
    ) or 0

    notes_count = db.scalar(
        select(func.count()).select_from(Note)
    ) or 0

    topics_count = db.scalar(
        select(func.count()).select_from(Topic)
    ) or 0

    sessions = db.scalars(
        select(StudySession).where(
            StudySession.started_at >= datetime.combine(
                week_start, time.min, tzinfo=timezone.utc
            ),
            StudySession.started_at < datetime.combine(
                today + timedelta(days=1),
                time.min,
                tzinfo=timezone.utc,
            ),
        )
    ).all()

    daily_seconds = {
        (week_start + timedelta(days=i)).isoformat(): 0
        for i in range(7)
    }

    today_seconds = 0

    for session in sessions:
        session_date = normalize_datetime(session.started_at).date()
        key = session_date.isoformat()

        if key in daily_seconds:
            daily_seconds[key] += session.duration_seconds

        if session_date == today:
            today_seconds += session.duration_seconds

    return {
        "total_study_seconds": total_seconds,
        "total_study_hours": round(total_seconds / 3600, 2),
        "sessions_count": sessions_count,
        "today_study_seconds": today_seconds,
        "today_study_minutes": round(today_seconds / 60, 1),
        "notes_count": notes_count,
        "topics_count": topics_count,
        "weekly_study": [
            {"date": day, "seconds": seconds}
            for day, seconds in daily_seconds.items()
        ],
    }
