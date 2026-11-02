import os
import re
import hmac
import json
import base64
import hashlib
import secrets

from datetime import datetime, date, timedelta, timezone
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr
from sqlalchemy import (
    create_engine,
    String,
    Integer,
    DateTime,
    Date,
    Text,
    ForeignKey,
    UniqueConstraint,
    func,
    select,
    text,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    Session,
    sessionmaker,
)

# ============================================================
# CONFIGURATION
# ============================================================

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is missing. Add it to backend/.env"
    )

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace(
        "postgres://",
        "postgresql://",
        1,
    )

TOKEN_SECRET = os.getenv("STUDYTRACK_SECRET_KEY")

if not TOKEN_SECRET or len(TOKEN_SECRET) < 32:
    raise RuntimeError(
        "Set STUDYTRACK_TOKEN_SECRET to a random secret "
        "of at least 32 characters in backend/.env"
    )

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
)


# ============================================================
# DATABASE MODELS
# ============================================================

class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "st_users"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )
    name: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
    )
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
    )
    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class StudyGroup(Base):
    __tablename__ = "st_groups"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    invite_code: Mapped[str] = mapped_column(
        String(16),
        unique=True,
        index=True,
        nullable=False,
    )
    created_by: Mapped[int] = mapped_column(
        ForeignKey("st_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class Membership(Base):
    __tablename__ = "st_group_memberships"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )
    group_id: Mapped[int] = mapped_column(
        ForeignKey("st_groups.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("st_users.id", ondelete="CASCADE"),
        index=True,
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        UniqueConstraint(
            "group_id",
            "user_id",
            name="uq_st_group_member",
        ),
    )


class Topic(Base):
    __tablename__ = "st_topics"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("st_users.id", ondelete="CASCADE"),
        index=True,
    )
    group_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("st_groups.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class Domain(Base):
    __tablename__ = "st_domains"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )
    topic_id: Mapped[int] = mapped_column(
        ForeignKey("st_topics.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class StudySession(Base):
    __tablename__ = "st_sessions"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )
    source_session_id: Mapped[Optional[str]] = mapped_column(
        String(120),
        unique=True,
        nullable=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("st_users.id", ondelete="CASCADE"),
        index=True,
    )
    group_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("st_groups.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    topic: Mapped[str] = mapped_column(
        String(80),
        default="General",
    )
    domain: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    duration_seconds: Mapped[int] = mapped_column(
        Integer,
        default=0,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
    )
    ended_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
    )
    site_url: Mapped[Optional[str]] = mapped_column(
        String(1000),
        nullable=True,
    )
    site_title: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )


class NotePage(Base):
    __tablename__ = "st_note_pages"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("st_users.id", ondelete="CASCADE"),
        index=True,
    )
    group_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("st_groups.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    topic: Mapped[str] = mapped_column(
        String(80),
        default="General",
    )
    domain: Mapped[str] = mapped_column(
        String(100),
        default="General",
    )
    title: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )
    content: Mapped[str] = mapped_column(
        Text,
        default="",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class CompetitionWinner(Base):
    __tablename__ = "st_competition_winners"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )
    group_id: Mapped[int] = mapped_column(
        ForeignKey("st_groups.id", ondelete="CASCADE"),
        index=True,
    )
    period_start: Mapped[date] = mapped_column(
        Date,
        index=True,
    )
    period_end: Mapped[date] = mapped_column(Date)
    winner_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("st_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    winner_name: Mapped[str] = mapped_column(String(80))
    winning_seconds: Mapped[int] = mapped_column(
        Integer,
        default=0,
    )
    saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        UniqueConstraint(
            "group_id",
            "period_start",
            name="uq_st_winner_period",
        ),
    )


Base.metadata.create_all(engine)


# ============================================================
# DATABASE DEPENDENCY
# ============================================================

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ============================================================
# PASSWORD AND TOKEN HELPERS
# ============================================================

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        260_000,
    )

    return (
        base64.b64encode(salt).decode()
        + "$"
        + base64.b64encode(digest).decode()
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_text, digest_text = stored.split("$", 1)

        salt = base64.b64decode(salt_text)
        expected = base64.b64decode(digest_text)

        actual = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            260_000,
        )

        return hmac.compare_digest(actual, expected)

    except Exception:
        return False


def token_for(user_id: int) -> str:
    payload_data = {
        "uid": user_id,
        "exp": int(
            datetime.now(timezone.utc).timestamp()
        ) + 60 * 60 * 24 * 14,
    }

    payload = base64.urlsafe_b64encode(
        json.dumps(payload_data).encode()
    ).decode().rstrip("=")

    signature = hmac.new(
        TOKEN_SECRET.encode(),
        payload.encode(),
        hashlib.sha256,
    ).digest()

    signature_text = base64.urlsafe_b64encode(
        signature
    ).decode().rstrip("=")

    return payload + "." + signature_text


def current_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> User:

    if not authorization or not authorization.lower().startswith(
        "bearer "
    ):
        raise HTTPException(
            status_code=401,
            detail="Please log in.",
        )

    try:
        payload, supplied_signature = authorization[7:].split(
            ".",
            1,
        )

        expected_signature = base64.urlsafe_b64encode(
            hmac.new(
                TOKEN_SECRET.encode(),
                payload.encode(),
                hashlib.sha256,
            ).digest()
        ).decode().rstrip("=")

        if not hmac.compare_digest(
            supplied_signature,
            expected_signature,
        ):
            raise ValueError("Invalid signature")

        padded_payload = payload + "=" * (
            -len(payload) % 4
        )

        data = json.loads(
            base64.urlsafe_b64decode(padded_payload)
        )

        if data["exp"] < int(
            datetime.now(timezone.utc).timestamp()
        ):
            raise ValueError("Expired token")

        user = db.get(User, int(data["uid"]))

        if user is None:
            raise ValueError("User not found")

        return user

    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Session expired. Please log in again.",
        )


# ============================================================
# PERMISSION AND DATE HELPERS
# ============================================================

def member_of(
    db: Session,
    group_id: int,
    user_id: int,
) -> bool:
    return (
        db.scalar(
            select(Membership.id).where(
                Membership.group_id == group_id,
                Membership.user_id == user_id,
            )
        )
        is not None
    )


def workspace_group(
    group_id: Optional[int],
    user: User,
    db: Session,
):
    if group_id is not None:
        group = db.get(StudyGroup, group_id)

        if group is None or not member_of(
            db,
            group_id,
            user.id,
        ):
            raise HTTPException(
                status_code=403,
                detail="You are not a member of this group.",
            )


def period_for(day: date):
    start = day - timedelta(days=day.weekday())
    return start, start + timedelta(days=6)


def group_week_rows(
    group_id: int,
    start: date,
    end: date,
    db: Session,
):
    members = db.execute(
        select(User.id, User.name)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.group_id == group_id)
    ).all()
    start_at = datetime.combine(
        start, datetime.min.time(), tzinfo=timezone.utc
    )
    end_at = datetime.combine(
        end + timedelta(days=1), datetime.min.time(),
        tzinfo=timezone.utc,
    )
    rows = []

    for member_id, name in members:
        seconds = db.scalar(
            select(func.coalesce(func.sum(StudySession.duration_seconds), 0))
            .where(
                StudySession.user_id == member_id,
                StudySession.group_id == group_id,
                StudySession.started_at >= start_at,
                StudySession.started_at < end_at,
            )
        ) or 0
        rows.append({
            "user_id": member_id,
            "name": name,
            "seconds": int(seconds),
            "hours": round(int(seconds) / 3600, 2),
        })

    return sorted(rows, key=lambda row: (-row["seconds"], row["name"].lower()))


def save_week_winner(
    group_id: int,
    start: date,
    end: date,
    db: Session,
):
    record = db.scalar(
        select(CompetitionWinner).where(
            CompetitionWinner.group_id == group_id,
            CompetitionWinner.period_start == start,
        )
    )
    if record:
        return record

    board = group_week_rows(group_id, start, end, db)
    winner = next((row for row in board if row["seconds"] > 0), None)
    record = CompetitionWinner(
        group_id=group_id,
        period_start=start,
        period_end=end,
        winner_user_id=winner["user_id"] if winner else None,
        winner_name=winner["name"] if winner else "No activity",
        winning_seconds=winner["seconds"] if winner else 0,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def finalize_completed_weeks(group: StudyGroup, db: Session):
    current_start, _ = period_for(date.today())
    first_start, _ = period_for(group.created_at.date())
    week_start = first_start

    while week_start < current_start:
        save_week_winner(
            group.id,
            week_start,
            week_start + timedelta(days=6),
            db,
        )
        week_start += timedelta(days=7)


def add_starter_dsa_topic(
    user_id: int,
    group_id: Optional[int],
    db: Session,
):
    topic = Topic(
        user_id=user_id,
        group_id=group_id,
        name="DSA",
    )
    db.add(topic)
    db.flush()
    db.add_all([
        Domain(topic_id=topic.id, name=name)
        for name in (
            "Arrays and Strings",
            "Linked Lists",
            "Stacks and Queues",
            "Trees and Graphs",
            "Dynamic Programming",
        )
    ])


def aware_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value


# ============================================================
# REQUEST SCHEMAS
# ============================================================

class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class GroupIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class JoinIn(BaseModel):
    invite_code: str = Field(min_length=4, max_length=16)


class TopicIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    group_id: Optional[int] = None


class DomainIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class NoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = ""
    topic: str = "General"
    domain: str = "General"
    group_id: Optional[int] = None


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    content: Optional[str] = None
    topic: Optional[str] = None
    domain: Optional[str] = None


class SessionIn(BaseModel):
    topic: str = "General"
    domain: Optional[str] = None
    duration_seconds: int = Field(ge=0, le=86400)
    started_at: datetime
    ended_at: datetime
    site_url: Optional[str] = None
    site_title: Optional[str] = None
    group_id: Optional[int] = None
    source_session_id: Optional[str] = None


class WebsiteSyncItem(BaseModel):
    id: str
    domain: str
    subject: str = "General"
    group_id: Optional[int] = None
    durationSeconds: int = Field(ge=0, le=86400)
    startedAt: datetime
    endedAt: datetime
    title: Optional[str] = None


# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="StudyTrack API",
    version="2.1.0",
)

origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "app": "StudyTrack",
        "status": "ok",
        "version": "2.1.0",
    }


@app.get("/health")
def health():
    return {"status": "ok"}


# ============================================================
# AUTHENTICATION
# ============================================================

@app.post("/auth/register")
def register(
    data: RegisterIn,
    db: Session = Depends(get_db),
):
    email = str(data.email).lower().strip()

    existing = db.scalar(
        select(User.id).where(
            func.lower(User.email) == email
        )
    )

    if existing:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists.",
        )

    user = User(
        name=data.name.strip(),
        email=email,
        password_hash=hash_password(data.password),
    )

    db.add(user)
    db.commit()
    db.refresh(user)
    add_starter_dsa_topic(user.id, None, db)
    db.commit()

    return {
        "token": token_for(user.id),
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
        },
    }


@app.post("/auth/login")
def login(
    data: LoginIn,
    db: Session = Depends(get_db),
):
    email = str(data.email).lower().strip()

    user = db.scalar(
        select(User).where(
            func.lower(User.email) == email
        )
    )

    if user is None or not verify_password(
        data.password,
        user.password_hash,
    ):
        raise HTTPException(
            status_code=401,
            detail="Email or password is incorrect.",
        )

    return {
        "token": token_for(user.id),
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
        },
    }


@app.get("/auth/me")
def me(user: User = Depends(current_user)):
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
    }


# ============================================================
# GROUPS
# ============================================================

@app.post("/groups")
def create_group(
    data: GroupIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    code = secrets.token_hex(4).upper()

    while db.scalar(
        select(StudyGroup.id).where(
            StudyGroup.invite_code == code
        )
    ):
        code = secrets.token_hex(4).upper()

    group = StudyGroup(
        name=data.name.strip(),
        invite_code=code,
        created_by=user.id,
    )

    db.add(group)
    db.flush()

    db.add(
        Membership(
            group_id=group.id,
            user_id=user.id,
        )
    )
    add_starter_dsa_topic(user.id, group.id, db)

    db.commit()
    db.refresh(group)

    return {
        "id": group.id,
        "name": group.name,
        "invite_code": group.invite_code,
        "member_count": 1,
    }


@app.post("/groups/join")
def join_group(
    data: JoinIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    code = data.invite_code.strip().upper()

    group = db.scalar(
        select(StudyGroup).where(
            func.upper(StudyGroup.invite_code) == code
        )
    )

    if group is None:
        raise HTTPException(
            status_code=404,
            detail="Invite code not found.",
        )

    if not member_of(db, group.id, user.id):
        db.add(
            Membership(
                group_id=group.id,
                user_id=user.id,
            )
        )
        db.commit()

    return {
        "id": group.id,
        "name": group.name,
        "invite_code": group.invite_code,
    }


@app.get("/groups")
def list_groups(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    groups = db.scalars(
        select(StudyGroup)
        .join(
            Membership,
            Membership.group_id == StudyGroup.id,
        )
        .where(Membership.user_id == user.id)
        .order_by(StudyGroup.name)
    ).all()

    result = []

    for group in groups:
        count = db.scalar(
            select(func.count(Membership.id)).where(
                Membership.group_id == group.id
            )
        ) or 0

        result.append({
            "id": group.id,
            "name": group.name,
            "invite_code": group.invite_code,
            "member_count": count,
        })

    return result


# ============================================================
# TOPICS AND DOMAINS
# ============================================================

@app.get("/topics")
def list_topics(
    group_id: Optional[int] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(group_id, user, db)

    query = select(Topic).where(
        Topic.group_id == group_id
    )

    if group_id is None:
        query = query.where(Topic.user_id == user.id)

    topics = db.scalars(
        query.order_by(Topic.name)
    ).all()

    result = []

    for topic in topics:
        domains = db.scalars(
            select(Domain)
            .where(Domain.topic_id == topic.id)
            .order_by(Domain.name)
        ).all()

        result.append({
            "id": topic.id,
            "name": topic.name,
            "group_id": topic.group_id,
            "domains": [
                {
                    "id": domain.id,
                    "name": domain.name,
                }
                for domain in domains
            ],
        })

    return result


@app.post("/topics")
def create_topic(
    data: TopicIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(data.group_id, user, db)

    name = data.name.strip()

    query = select(Topic.id).where(
        func.lower(Topic.name) == name.lower(),
        Topic.group_id == data.group_id,
    )
    if data.group_id is None:
        query = query.where(Topic.user_id == user.id)

    if db.scalar(query):
        raise HTTPException(
            status_code=409,
            detail="That topic already exists in this workspace.",
        )

    topic = Topic(
        user_id=user.id,
        group_id=data.group_id,
        name=name,
    )

    db.add(topic)
    db.commit()
    db.refresh(topic)

    return {
        "id": topic.id,
        "name": topic.name,
        "group_id": topic.group_id,
        "domains": [],
    }


@app.post("/topics/{topic_id}/domains")
def create_domain(
    topic_id: int,
    data: DomainIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    topic = db.get(Topic, topic_id)

    if topic is None:
        raise HTTPException(
            status_code=404,
            detail="Topic not found.",
        )

    if topic.group_id is None:
        if topic.user_id != user.id:
            raise HTTPException(
                status_code=404,
                detail="Topic not found.",
            )
    elif not member_of(db, topic.group_id, user.id):
        raise HTTPException(
            status_code=403,
            detail="You are not a member of this group.",
        )

    name = data.name.strip()

    existing = db.scalar(
        select(Domain.id).where(
            Domain.topic_id == topic_id,
            func.lower(Domain.name) == name.lower(),
        )
    )

    if existing:
        raise HTTPException(
            status_code=409,
            detail="Domain already exists.",
        )

    domain = Domain(
        topic_id=topic_id,
        name=name,
    )

    db.add(domain)
    db.commit()
    db.refresh(domain)

    return {
        "id": domain.id,
        "name": domain.name,
        "topic_id": topic_id,
    }


# ============================================================
# STUDY SESSIONS
# ============================================================

def session_json(session: StudySession):
    return {
        "id": session.id,
        "topic": session.topic,
        "subject": session.topic,
        "domain": session.domain,
        "duration_seconds": session.duration_seconds,
        "started_at": session.started_at.isoformat(),
        "ended_at": session.ended_at.isoformat(),
        "site_url": session.site_url,
        "site_title": session.site_title,
        "group_id": session.group_id,
    }


@app.post("/sessions")
def create_session(
    data: SessionIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(data.group_id, user, db)

    if data.source_session_id:
        existing = db.scalar(
            select(StudySession).where(
                StudySession.source_session_id
                == data.source_session_id
            )
        )

        if existing:
            if existing.user_id != user.id:
                raise HTTPException(
                    status_code=409,
                    detail="This session ID is already in use.",
                )
            return {
                **session_json(existing),
                "duplicate": True,
            }

    started = aware_datetime(data.started_at)
    ended = aware_datetime(data.ended_at)

    if ended < started:
        raise HTTPException(
            status_code=400,
            detail="Session end time cannot be before its start time.",
        )

    session = StudySession(
        user_id=user.id,
        group_id=data.group_id,
        topic=data.topic.strip() or "General",
        domain=data.domain,
        duration_seconds=data.duration_seconds,
        started_at=started,
        ended_at=ended,
        site_url=data.site_url,
        site_title=data.site_title,
        source_session_id=data.source_session_id,
    )

    db.add(session)
    db.commit()
    db.refresh(session)

    return session_json(session)


@app.post("/sessions/website-sync")
def website_sync(
    items: list[WebsiteSyncItem],
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    saved = 0

    for item in items:
        workspace_group(item.group_id, user, db)

        existing = db.scalar(
            select(StudySession).where(
                StudySession.source_session_id == item.id
            )
        )

        if existing:
            # Never let one user's sync overwrite another user's session.
            if existing.user_id != user.id:
                continue
            continue

        host = re.sub(
            r"^https?://",
            "",
            item.domain.strip(),
            flags=re.IGNORECASE,
        ).split("/")[0].lower()

        if not host or "." not in host:
            continue

        started = aware_datetime(item.startedAt)
        ended = aware_datetime(item.endedAt)

        if ended < started:
            continue

        session = StudySession(
            user_id=user.id,
            group_id=item.group_id,
            topic=item.subject.strip() or "General",
            duration_seconds=item.durationSeconds,
            started_at=started,
            ended_at=ended,
            site_url="https://" + host,
            site_title=item.title or host,
            source_session_id=item.id,
        )

        db.add(session)
        saved += 1

    db.commit()

    return {"saved": saved}


@app.get("/sessions")
def list_sessions(
    limit: int = Query(100, ge=1, le=500),
    group_id: Optional[int] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(group_id, user, db)

    query = select(StudySession).where(
        StudySession.user_id == user.id,
        StudySession.group_id == group_id,
    )

    query = query.order_by(
        StudySession.started_at.desc()
    ).limit(limit)

    return [
        session_json(session)
        for session in db.scalars(query).all()
    ]


# ============================================================
# NOTES
# ============================================================

def note_json(note: NotePage):
    return {
        "id": note.id,
        "title": note.title,
        "content": note.content,
        "topic": note.topic,
        "domain": note.domain,
        "group_id": note.group_id,
        "created_at": note.created_at.isoformat(),
        "updated_at": note.updated_at.isoformat(),
    }


@app.post("/notes")
def create_note(
    data: NoteIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(data.group_id, user, db)

    note = NotePage(
        user_id=user.id,
        group_id=data.group_id,
        title=data.title.strip(),
        content=data.content,
        topic=data.topic.strip() or "General",
        domain=data.domain.strip() or "General",
    )

    db.add(note)
    db.commit()
    db.refresh(note)

    return note_json(note)


@app.get("/notes")
def list_notes(
    search: str = "",
    group_id: Optional[int] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(group_id, user, db)

    query = select(NotePage).where(
        NotePage.user_id == user.id,
        NotePage.group_id == group_id,
    )

    if search.strip():
        pattern = f"%{search.strip()}%"

        query = query.where(
            (NotePage.title.ilike(pattern))
            | (NotePage.content.ilike(pattern))
            | (NotePage.topic.ilike(pattern))
            | (NotePage.domain.ilike(pattern))
        )

    notes = db.scalars(
        query.order_by(NotePage.updated_at.desc())
    ).all()

    return [note_json(note) for note in notes]


@app.put("/notes/{note_id}")
def update_note(
    note_id: int,
    data: NoteUpdate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    note = db.get(NotePage, note_id)

    if note is None or note.user_id != user.id:
        raise HTTPException(
            status_code=404,
            detail="Note not found.",
        )

    updates = data.model_dump(exclude_unset=True)

    for key, value in updates.items():
        if value is not None:
            if isinstance(value, str):
                value = value.strip() if key != "content" else value
            setattr(note, key, value)

    note.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(note)

    return note_json(note)


@app.delete("/notes/{note_id}")
def delete_note(
    note_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    note = db.get(NotePage, note_id)

    if note is None or note.user_id != user.id:
        raise HTTPException(
            status_code=404,
            detail="Note not found.",
        )

    db.delete(note)
    db.commit()

    return {"ok": True}


# ============================================================
# DASHBOARD
# ============================================================

@app.get("/dashboard/summary")
def dashboard(
    group_id: Optional[int] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(group_id, user, db)

    query = select(StudySession).where(
        StudySession.user_id == user.id,
        StudySession.group_id == group_id,
    )

    sessions = db.scalars(query).all()

    today = datetime.now(timezone.utc).date()
    week_start = today - timedelta(days=6)

    today_seconds = sum(
        session.duration_seconds
        for session in sessions
        if session.started_at.date() == today
    )

    weekly = []

    for offset in range(7):
        day = week_start + timedelta(days=offset)

        seconds = sum(
            session.duration_seconds
            for session in sessions
            if session.started_at.date() == day
        )

        weekly.append({
            "date": day.isoformat(),
            "seconds": seconds,
        })

    total_seconds = sum(
        session.duration_seconds
        for session in sessions
    )

    note_count = db.scalar(
        select(func.count(NotePage.id)).where(
            NotePage.user_id == user.id,
            NotePage.group_id == group_id,
        )
    ) or 0

    topic_count = db.scalar(
        select(func.count(Topic.id)).where(
            Topic.user_id == user.id,
            Topic.group_id == group_id,
        )
    ) or 0

    return {
        "total_seconds": total_seconds,
        "total_hours": round(total_seconds / 3600, 2),
        "sessions_count": len(sessions),
        "today_seconds": today_seconds,
        "today_minutes": round(today_seconds / 60),
        "notes_count": note_count,
        "topics_count": topic_count,
        "weekly_study": weekly,
    }


# ============================================================
# GROUP LEADERBOARD AND COMPETITION WINNERS
# ============================================================

@app.get("/groups/{group_id}/leaderboard")
def leaderboard(
    group_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(group_id, user, db)
    group = db.get(StudyGroup, group_id)
    finalize_completed_weeks(group, db)
    start, end = period_for(date.today())
    rows = group_week_rows(group_id, start, end, db)

    saved = db.scalar(
        select(CompetitionWinner).where(
            CompetitionWinner.group_id == group_id,
            CompetitionWinner.period_start == start,
        )
    )

    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "leaderboard": rows,
        "winner": None if saved is None else {
            "name": saved.winner_name,
            "seconds": saved.winning_seconds,
        },
    }


@app.post("/groups/{group_id}/finalize-current-period")
def finalize_period(
    group_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    group = db.get(StudyGroup, group_id)

    if group is None or group.created_by != user.id:
        raise HTTPException(
            status_code=403,
            detail="Only the group creator can finalize a competition period.",
        )

    current_start, _ = period_for(date.today())
    start = current_start - timedelta(days=7)
    end = start + timedelta(days=6)
    existing = db.scalar(
        select(CompetitionWinner).where(
            CompetitionWinner.group_id == group_id,
            CompetitionWinner.period_start == start,
        )
    )
    record = save_week_winner(group_id, start, end, db)

    return {
        "winner": record.winner_name,
        "seconds": record.winning_seconds,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "already_finalized": existing is not None,
    }


@app.get("/groups/{group_id}/winners")
def winners(
    group_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(group_id, user, db)
    group = db.get(StudyGroup, group_id)
    finalize_completed_weeks(group, db)

    records = db.scalars(
        select(CompetitionWinner)
        .where(CompetitionWinner.group_id == group_id)
        .order_by(CompetitionWinner.period_start.desc())
        .limit(4)
    ).all()

    return [
        {
            "period_start": record.period_start.isoformat(),
            "period_end": record.period_end.isoformat(),
            "winner": record.winner_name,
            "seconds": record.winning_seconds,
        }
        for record in records
    ]


# ============================================================
# SESSION RETENTION
# ============================================================

@app.post("/maintenance/cleanup-old-sessions")
def cleanup_old_sessions(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    # Delete sessions older than 90 days.
    # Notes and competition winner records remain untouched.
    groups = db.scalars(
        select(StudyGroup)
        .join(Membership, Membership.group_id == StudyGroup.id)
        .where(Membership.user_id == user.id)
    ).all()
    for group in groups:
        finalize_completed_weeks(group, db)

    cutoff = datetime.now(timezone.utc) - timedelta(days=90)

    result = db.execute(
        text(
            "DELETE FROM st_sessions "
            "WHERE user_id = :user_id AND ended_at < :cutoff"
        ),
        {"user_id": user.id, "cutoff": cutoff},
    )

    db.commit()

    return {
        "deleted_sessions": result.rowcount or 0,
        "retention_days": 90,
    }