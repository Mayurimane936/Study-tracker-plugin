
import os
import re
import hmac
import json
import base64
import hashlib
import secrets
import calendar
import asyncio
import logging

from contextlib import suppress, asynccontextmanager
from datetime import datetime, date, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit

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

logger = logging.getLogger("studytrack.retention")

SESSION_RETENTION_DAYS = 90
RETENTION_CHECK_INTERVAL_SECONDS = 60

INDIA_TZ = ZoneInfo("Asia/Kolkata")

_retention_task = None


def india_now() -> datetime:
    return datetime.now(INDIA_TZ)


def india_today() -> date:
    return india_now().date()


def normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgres://"):
        return database_url.replace(
            "postgres://",
            "postgresql+psycopg://",
            1,
        )

    if database_url.startswith("postgresql://"):
        return database_url.replace(
            "postgresql://",
            "postgresql+psycopg://",
            1,
        )

    return database_url


load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is missing. Add it to backend/.env"
    )

DATABASE_URL = normalize_database_url(DATABASE_URL)

TOKEN_SECRET = os.getenv("STUDYTRACK_SECRET_KEY")

if not TOKEN_SECRET or len(TOKEN_SECRET) < 32:
    raise RuntimeError(
        "Set STUDYTRACK_SECRET_KEY to a random secret "
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


# ============================================================
# SHARED GROUP STUDY SITES MODEL
# ============================================================

class GroupStudySite(Base):
    __tablename__ = "st_group_study_sites"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    group_id: Mapped[int] = mapped_column(
        ForeignKey("st_groups.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    domain: Mapped[str] = mapped_column(
        String(253),
        nullable=False,
    )

    proposed_by: Mapped[int] = mapped_column(
        ForeignKey("st_users.id", ondelete="CASCADE"),
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="pending",
        nullable=False,
    )

    enabled: Mapped[bool] = mapped_column(
        default=True,
        nullable=False,
    )

    paused_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    reviewed_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("st_users.id", ondelete="SET NULL"),
        nullable=True,
    )

    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        UniqueConstraint(
            "group_id",
            "domain",
            name="uq_st_group_study_site",
        ),
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


class NoteAppendEvent(Base):
    __tablename__ = "st_note_append_events"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("st_users.id", ondelete="CASCADE"),
        index=True,
    )

    source_note_id: Mapped[str] = mapped_column(
        String(120),
    )

    note_page_id: Mapped[int] = mapped_column(
        ForeignKey("st_note_pages.id", ondelete="CASCADE"),
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "source_note_id",
            name="uq_st_note_append_source",
        ),
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

    winner_name: Mapped[str] = mapped_column(
        String(80),
    )

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


class CompetitionRoundWinner(Base):
    __tablename__ = "st_competition_round_winners"

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

    winner_name: Mapped[str] = mapped_column(
        String(80),
    )

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
            name="uq_st_round_winner_period",
        ),
    )


# Creates any new tables, including st_group_study_sites.
Base.metadata.create_all(engine)

# Add the enabled flag to existing installations without requiring a manual
# database reset. PostgreSQL supports ADD COLUMN IF NOT EXISTS.
with engine.begin() as connection:
    connection.execute(text(
        "ALTER TABLE st_group_study_sites "
        "ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE"
    ))
    connection.execute(text(
        "ALTER TABLE st_group_study_sites "
        "ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ NULL"
    ))
    connection.execute(text(
        "ALTER TABLE st_group_study_sites "
        "ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL"
    ))


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


def normalize_study_domain(value: str) -> str:
    """
    Normalize a website URL or domain to its hostname.

    Examples:
        https://leetcode.com/problems/ -> leetcode.com
        www.github.com -> www.github.com
        github.com -> github.com

    Only HTTP and HTTPS URLs are accepted.
    """

    value = value.strip().lower()

    if not value:
        raise HTTPException(
            status_code=400,
            detail="Website domain is required.",
        )

    if "://" not in value:
        value = "https://" + value

    try:
        parsed = urlsplit(value)

        if parsed.scheme not in {"http", "https"}:
            raise ValueError("Invalid scheme")

        if not parsed.hostname:
            raise ValueError("Missing hostname")

        if parsed.username or parsed.password:
            raise ValueError("Credentials are not allowed")

        if parsed.port and not (
            (parsed.scheme == "http" and parsed.port == 80)
            or (parsed.scheme == "https" and parsed.port == 443)
        ):
            raise ValueError("Custom ports are not allowed")

        hostname = (
            parsed.hostname
            .rstrip(".")
            .encode("idna")
            .decode("ascii")
            .lower()
        )

        if (
            len(hostname) > 253
            or "." not in hostname
            or any(
                not re.fullmatch(
                    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?",
                    label,
                )
                for label in hostname.split(".")
            )
        ):
            raise ValueError("Invalid hostname")

        return hostname

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Enter a valid website domain, such as leetcode.com.",
        )


def study_site_json(
    site: GroupStudySite,
    db: Session,
):
    proposer = db.get(User, site.proposed_by)

    reviewer = (
        db.get(User, site.reviewed_by)
        if site.reviewed_by
        else None
    )

    return {
        "id": site.id,
        "group_id": site.group_id,
        "domain": site.domain,
        "status": site.status,
        "enabled": bool(site.enabled),
        "proposed_by": site.proposed_by,
        "proposed_by_name": (
            proposer.name if proposer else "Unknown"
        ),
        "reviewed_by": site.reviewed_by,
        "reviewed_by_name": (
            reviewer.name if reviewer else None
        ),
        "reviewed_at": (
            site.reviewed_at.isoformat()
            if site.reviewed_at else None
        ),
        "created_at": site.created_at.isoformat(),
    }


def aware_datetime(value: datetime) -> datetime:
    """
    Make a datetime timezone-aware.

    Naive datetimes are treated as UTC to preserve the
    existing storage convention.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value


def to_india_datetime(value: datetime) -> datetime:
    return aware_datetime(value).astimezone(INDIA_TZ)


def period_for(day: date):
    """
    Fixed date rounds:
    1-7, 8-14, 15-21, 22-month-end.
    """

    month_end = date(
        day.year,
        day.month,
        calendar.monthrange(day.year, day.month)[1],
    )

    if day.day <= 7:
        start_day = 1
        end_day = 7

    elif day.day <= 14:
        start_day = 8
        end_day = 14

    elif day.day <= 21:
        start_day = 15
        end_day = 21

    else:
        start_day = 22
        end_day = month_end.day

    start = date(day.year, day.month, start_day)

    end = date(
        day.year,
        day.month,
        min(end_day, month_end.day),
    )

    return start, end


def month_for(day: date):
    start = day.replace(day=1)

    end = day.replace(
        day=calendar.monthrange(day.year, day.month)[1]
    )

    return start, end


def india_day_bounds_utc(
    start: date,
    end: date,
):
    start_ist = datetime.combine(
        start,
        datetime.min.time(),
        tzinfo=INDIA_TZ,
    )

    end_ist = datetime.combine(
        end + timedelta(days=1),
        datetime.min.time(),
        tzinfo=INDIA_TZ,
    )

    return (
        start_ist.astimezone(timezone.utc),
        end_ist.astimezone(timezone.utc),
    )


def group_period_rows(
    group_id: int,
    start: date,
    end: date,
    db: Session,
):
    members = db.execute(
        select(User.id, User.name)
        .join(
            Membership,
            Membership.user_id == User.id,
        )
        .where(Membership.group_id == group_id)
    ).all()

    start_at, end_at = india_day_bounds_utc(
        start,
        end,
    )

    rows = []

    for member_id, name in members:
        seconds = db.scalar(
            select(
                func.coalesce(
                    func.sum(StudySession.duration_seconds),
                    0,
                )
            ).where(
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

    return sorted(
        rows,
        key=lambda row: (
            -row["seconds"],
            row["name"].lower(),
        ),
    )


# ============================================================
# MONTHLY WINNER FINALIZATION
# ============================================================

def save_month_winner(
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

    if record is not None:
        return record

    board = group_period_rows(
        group_id,
        start,
        end,
        db,
    )

    winner = next(
        (
            row for row in board
            if row["seconds"] > 0
        ),
        None,
    )

    record = CompetitionWinner(
        group_id=group_id,
        period_start=start,
        period_end=end,
        winner_user_id=(
            winner["user_id"] if winner else None
        ),
        winner_name=(
            winner["name"] if winner else "No activity"
        ),
        winning_seconds=(
            winner["seconds"] if winner else 0
        ),
    )

    db.add(record)
    db.commit()
    db.refresh(record)

    return record


def finalize_completed_months(
    group: StudyGroup,
    db: Session,
):
    today = india_today()

    current_month_start, _ = month_for(today)

    group_created_date = to_india_datetime(
        group.created_at
    ).date()

    first_month_start, _ = month_for(
        group_created_date
    )

    month_start = first_month_start

    while month_start < current_month_start:
        _, month_end = month_for(month_start)

        save_month_winner(
            group.id,
            month_start,
            month_end,
            db,
        )

        month_start = month_end + timedelta(days=1)


# ============================================================
# DATE-ROUND WINNER FINALIZATION
# ============================================================

def save_round_winner(
    group_id: int,
    start: date,
    end: date,
    db: Session,
):
    record = db.scalar(
        select(CompetitionRoundWinner).where(
            CompetitionRoundWinner.group_id == group_id,
            CompetitionRoundWinner.period_start == start,
        )
    )

    if record is not None:
        return record

    board = group_period_rows(
        group_id,
        start,
        end,
        db,
    )

    winner = next(
        (
            row for row in board
            if row["seconds"] > 0
        ),
        None,
    )

    record = CompetitionRoundWinner(
        group_id=group_id,
        period_start=start,
        period_end=end,
        winner_user_id=(
            winner["user_id"] if winner else None
        ),
        winner_name=(
            winner["name"] if winner else "No activity"
        ),
        winning_seconds=(
            winner["seconds"] if winner else 0
        ),
    )

    db.add(record)
    db.commit()
    db.refresh(record)

    return record


def finalize_completed_rounds(
    group: StudyGroup,
    db: Session,
):
    today = india_today()

    current_start, _ = period_for(today)

    group_created_date = to_india_datetime(
        group.created_at
    ).date()

    round_start, _ = period_for(
        group_created_date
    )

    while round_start < current_start:
        _, round_end = period_for(round_start)

        save_round_winner(
            group.id,
            round_start,
            round_end,
            db,
        )

        round_start = round_end + timedelta(days=1)


# ============================================================
# STARTER TOPICS
# ============================================================

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
        Domain(
            topic_id=topic.id,
            name=name,
        )
        for name in (
            "Arrays and Strings",
            "Linked Lists",
            "Stacks and Queues",
            "Trees and Graphs",
            "Dynamic Programming",
        )
    ])


# ============================================================
# SESSION RETENTION
# ============================================================

def prune_expired_sessions(
    user_id: Optional[int] = None,
) -> int:
    db = SessionLocal()

    try:
        groups_query = select(StudyGroup)

        if user_id is not None:
            groups_query = (
                groups_query
                .join(
                    Membership,
                    Membership.group_id == StudyGroup.id,
                )
                .where(Membership.user_id == user_id)
            )

        groups = db.scalars(groups_query).all()

        for group in groups:
            finalize_completed_rounds(
                group,
                db,
            )

            finalize_completed_months(
                group,
                db,
            )

        cutoff = datetime.now(timezone.utc) - timedelta(
            days=SESSION_RETENTION_DAYS
        )

        statement = (
            "DELETE FROM st_sessions WHERE ended_at < :cutoff"
        )

        parameters = {
            "cutoff": cutoff,
        }

        if user_id is not None:
            statement += " AND user_id = :user_id"
            parameters["user_id"] = user_id

        result = db.execute(
            text(statement),
            parameters,
        )

        db.commit()

        return result.rowcount or 0

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


async def session_retention_loop():
    while True:
        try:
            deleted = await asyncio.to_thread(
                prune_expired_sessions
            )

            if deleted:
                logger.info(
                    "Removed %s study sessions older than %s days.",
                    deleted,
                    SESSION_RETENTION_DAYS,
                )

        except Exception:
            logger.exception(
                "Automatic session retention failed."
            )

        await asyncio.sleep(
            RETENTION_CHECK_INTERVAL_SECONDS
        )


# ============================================================
# REQUEST SCHEMAS
# ============================================================

class RegisterIn(BaseModel):
    name: str = Field(
        min_length=2,
        max_length=80,
    )

    email: EmailStr

    password: str = Field(
        min_length=8,
        max_length=128,
    )


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class GroupIn(BaseModel):
    name: str = Field(
        min_length=2,
        max_length=100,
    )


class JoinIn(BaseModel):
    invite_code: str = Field(
        min_length=4,
        max_length=16,
    )


class TopicIn(BaseModel):
    name: str = Field(
        min_length=1,
        max_length=80,
    )

    group_id: Optional[int] = None


class DomainIn(BaseModel):
    name: str = Field(
        min_length=1,
        max_length=100,
    )


class StudySiteIn(BaseModel):
    domain: str = Field(
        min_length=3,
        max_length=2000,
    )


class NoteIn(BaseModel):
    title: str = Field(
        min_length=1,
        max_length=200,
    )

    content: str = ""
    topic: str = "General"
    domain: str = "General"
    group_id: Optional[int] = None


class NoteAppendIn(BaseModel):
    source_note_id: str = Field(
        min_length=1,
        max_length=120,
    )

    title: str = Field(
        default="Saved selection",
        max_length=200,
    )

    content: str = Field(
        min_length=1,
        max_length=50000,
    )

    topic: str = Field(
        default="General",
        min_length=1,
        max_length=80,
    )

    domain: str = Field(
        default="General",
        min_length=1,
        max_length=100,
    )

    source_url: Optional[str] = Field(
        default=None,
        max_length=2000,
    )

    group_id: Optional[int] = None


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(
        default=None,
        max_length=200,
    )

    content: Optional[str] = None
    topic: Optional[str] = None
    domain: Optional[str] = None


class SessionIn(BaseModel):
    topic: str = "General"
    domain: Optional[str] = None

    duration_seconds: int = Field(
        ge=0,
        le=86400,
    )

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

    durationSeconds: int = Field(
        ge=0,
        le=86400,
    )

    startedAt: datetime
    endedAt: datetime

    title: Optional[str] = None


# ============================================================
# FASTAPI APP
# ============================================================

@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _retention_task

    _retention_task = asyncio.create_task(
        session_retention_loop()
    )

    try:
        yield

    finally:
        if _retention_task is not None:
            _retention_task.cancel()

            with suppress(asyncio.CancelledError):
                await _retention_task

            _retention_task = None


api_docs_enabled = (
    os.getenv(
        "ENABLE_API_DOCS",
        "false",
    ).strip().lower()
    in {"1", "true", "yes"}
)

app = FastAPI(
    title="StudyTrack API",
    version="2.3.0",
    lifespan=lifespan,
    docs_url="/docs" if api_docs_enabled else None,
    redoc_url="/redoc" if api_docs_enabled else None,
    openapi_url="/openapi.json" if api_docs_enabled else None,
)


origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "",
    ).split(",")
    if origin.strip()
]


app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=os.getenv("CORS_ORIGIN_REGEX") or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "app": "StudyTrack",
        "status": "ok",
        "version": "2.3.0",
    }


@app.get("/health")
def health():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

    except Exception as error:
        logger.exception(
            "Health check database query failed."
        )

        raise HTTPException(
            status_code=503,
            detail="Database unavailable.",
        ) from error

    return {
        "status": "ok",
        "database": "ok",
    }


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

    add_starter_dsa_topic(
        user.id,
        None,
        db,
    )

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
def me(
    user: User = Depends(current_user),
):
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

    add_starter_dsa_topic(
        user.id,
        group.id,
        db,
    )

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
            "created_by": group.created_by,
            "member_count": count,
        })

    return result


# ============================================================
# SHARED GROUP STUDY SITES
# ============================================================

@app.post("/groups/{group_id}/study-sites")
def propose_study_site(
    group_id: int,
    data: StudySiteIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(
        group_id,
        user,
        db,
    )

    domain = normalize_study_domain(data.domain)

    existing = db.scalar(
        select(GroupStudySite).where(
            GroupStudySite.group_id == group_id,
            GroupStudySite.domain == domain,
        )
    )

    if existing:
        if existing.deleted_at is None and existing.status == "approved":
            raise HTTPException(
                status_code=409,
                detail="This website is already approved for your group.",
            )

        if existing.deleted_at is None and existing.status == "pending":
            raise HTTPException(
                status_code=409,
                detail="This website is already awaiting approval.",
            )

        # Allow a rejected or previously deleted website to be proposed again.
        existing.status = "pending"
        existing.enabled = True
        existing.paused_at = None
        existing.deleted_at = None
        existing.proposed_by = user.id
        existing.reviewed_by = None
        existing.reviewed_at = None
        existing.created_at = datetime.now(timezone.utc)

        db.commit()
        db.refresh(existing)

        return study_site_json(existing, db)

    site = GroupStudySite(
        group_id=group_id,
        domain=domain,
        proposed_by=user.id,
        status="pending",
    )

    db.add(site)

    try:
        db.commit()
    except Exception:
        db.rollback()

        raise HTTPException(
            status_code=409,
            detail="This website has already been submitted.",
        )

    db.refresh(site)

    return study_site_json(site, db)


@app.get("/groups/{group_id}/study-sites")
def list_group_study_sites(
    group_id: int,
    status: Optional[str] = Query(
        default=None,
        pattern="^(pending|approved|rejected)$",
    ),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(
        group_id,
        user,
        db,
    )

    query = select(GroupStudySite).where(
        GroupStudySite.group_id == group_id,
        GroupStudySite.deleted_at.is_(None),
    )

    if status:
        query = query.where(
            GroupStudySite.status == status
        )

    sites = db.scalars(
        query.order_by(
            GroupStudySite.created_at.desc()
        )
    ).all()

    return [
        study_site_json(site, db)
        for site in sites
    ]


@app.post("/groups/{group_id}/study-sites/{site_id}/approve")
def approve_study_site(
    group_id: int,
    site_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(
        group_id,
        user,
        db,
    )

    site = db.scalar(
        select(GroupStudySite).where(
            GroupStudySite.id == site_id,
            GroupStudySite.group_id == group_id,
        )
    )

    if site is None:
        raise HTTPException(
            status_code=404,
            detail="Study site not found.",
        )

    if site.proposed_by == user.id:
        raise HTTPException(
            status_code=403,
            detail="You cannot approve your own website proposal.",
        )

    if site.status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"This website is already {site.status}.",
        )

    site.status = "approved"
    site.reviewed_by = user.id
    site.reviewed_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(site)

    return {
        "message": "Website approved successfully.",
        "site": study_site_json(site, db),
    }


@app.post("/groups/{group_id}/study-sites/{site_id}/reject")
def reject_study_site(
    group_id: int,
    site_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(
        group_id,
        user,
        db,
    )

    site = db.scalar(
        select(GroupStudySite).where(
            GroupStudySite.id == site_id,
            GroupStudySite.group_id == group_id,
        )
    )

    if site is None:
        raise HTTPException(
            status_code=404,
            detail="Study site not found.",
        )

    if site.proposed_by == user.id:
        raise HTTPException(
            status_code=403,
            detail="You cannot reject your own website proposal.",
        )

    if site.status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"This website is already {site.status}.",
        )

    site.status = "rejected"
    site.reviewed_by = user.id
    site.reviewed_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(site)

    return {
        "message": "Website rejected.",
        "site": study_site_json(site, db),
    }


@app.post("/groups/{group_id}/study-sites/{site_id}/pause")
def pause_group_study_site(
    group_id: int,
    site_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(group_id, user, db)
    site = db.scalar(select(GroupStudySite).where(
        GroupStudySite.id == site_id,
        GroupStudySite.group_id == group_id,
    ))
    if site is None:
        raise HTTPException(status_code=404, detail="Study site not found.")

    group = db.get(StudyGroup, group_id)
    if site.proposed_by != user.id and group.created_by != user.id:
        raise HTTPException(
            status_code=403,
            detail="Only the member who suggested this site or the group owner can manage it.",
        )
    if site.status != "approved":
        raise HTTPException(
            status_code=409,
            detail="Only approved study sites can be paused.",
        )

    site.enabled = False
    site.paused_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(site)
    return {"message": "Study site paused.", "site": study_site_json(site, db)}


@app.post("/groups/{group_id}/study-sites/{site_id}/resume")
def resume_group_study_site(
    group_id: int,
    site_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(group_id, user, db)
    site = db.scalar(select(GroupStudySite).where(
        GroupStudySite.id == site_id,
        GroupStudySite.group_id == group_id,
    ))
    if site is None:
        raise HTTPException(status_code=404, detail="Study site not found.")

    group = db.get(StudyGroup, group_id)
    if site.proposed_by != user.id and group.created_by != user.id:
        raise HTTPException(
            status_code=403,
            detail="Only the member who suggested this site or the group owner can manage it.",
        )
    if site.status != "approved":
        raise HTTPException(
            status_code=409,
            detail="Only approved study sites can be resumed.",
        )

    site.enabled = True
    site.paused_at = None
    db.commit()
    db.refresh(site)
    return {"message": "Study site resumed.", "site": study_site_json(site, db)}


@app.delete("/groups/{group_id}/study-sites/{site_id}")
def delete_group_study_site(
    group_id: int,
    site_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(group_id, user, db)
    site = db.scalar(select(GroupStudySite).where(
        GroupStudySite.id == site_id,
        GroupStudySite.group_id == group_id,
    ))
    if site is None:
        raise HTTPException(status_code=404, detail="Study site not found.")

    group = db.get(StudyGroup, group_id)
    if site.proposed_by != user.id and group.created_by != user.id:
        raise HTTPException(
            status_code=403,
            detail="Only the member who suggested this site or the group owner can delete it.",
        )

    now = datetime.now(timezone.utc)
    site.enabled = False
    site.paused_at = now
    site.deleted_at = now
    db.commit()
    return {"message": "Study site deleted.", "id": site_id}


# ============================================================
# TOPICS AND DOMAINS
# ============================================================

@app.get("/topics")
def list_topics(
    group_id: Optional[int] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(
        group_id,
        user,
        db,
    )

    query = select(Topic).where(
        Topic.group_id == group_id
    )

    if group_id is None:
        query = query.where(
            Topic.user_id == user.id
        )

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
    workspace_group(
        data.group_id,
        user,
        db,
    )

    name = data.name.strip()

    query = select(Topic.id).where(
        func.lower(Topic.name) == name.lower(),
        Topic.group_id == data.group_id,
    )

    if data.group_id is None:
        query = query.where(
            Topic.user_id == user.id
        )

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
    topic = db.get(
        Topic,
        topic_id,
    )

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

    elif not member_of(
        db,
        topic.group_id,
        user.id,
    ):
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
        # Only sessions entered through the dashboard's manual form have
        # neither a sync source ID nor a website URL.
        "is_manual": (
            session.source_session_id is None
            and session.site_url is None
        ),
    }


@app.post("/sessions")
def create_session(
    data: SessionIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(
        data.group_id,
        user,
        db,
    )

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

    retention_cutoff = (
        datetime.now(timezone.utc)
        - timedelta(days=SESSION_RETENTION_DAYS)
    )

    if ended < retention_cutoff:
        raise HTTPException(
            status_code=410,
            detail="This session is older than the 90-day retention window.",
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
    expired = 0
    unapproved = 0
    duplicates = 0

    try:
        for item in items:
            workspace_group(
                item.group_id,
                user,
                db,
            )

            existing = db.scalar(
                select(StudySession).where(
                    StudySession.source_session_id == item.id
                )
            )

            if existing:
                if existing.user_id != user.id:
                    continue

                duplicates += 1
                continue

            try:
                host = normalize_study_domain(item.domain)
            except HTTPException:
                continue

            started = aware_datetime(item.startedAt)
            ended = aware_datetime(item.endedAt)

            if ended < started:
                continue

            if item.group_id is not None:
                candidate_sites = db.scalars(
                    select(GroupStudySite).where(
                        GroupStudySite.group_id == item.group_id,
                        GroupStudySite.status == "approved",
                        (
                            GroupStudySite.enabled.is_(True)
                            |
                            (
                                GroupStudySite.paused_at.is_not(None)
                                & (GroupStudySite.paused_at > started)
                            )
                            |
                            (
                                GroupStudySite.deleted_at.is_not(None)
                                & (GroupStudySite.deleted_at > started)
                            )
                        ),
                    )
                ).all()

                approved_site = next(
                    (
                        site
                        for site in candidate_sites
                        if (
                            host == site.domain
                            or host.endswith("." + site.domain)
                        )
                    ),
                    None,
                )

                if approved_site is None:
                    unapproved += 1
                    continue

                stop_at = None

                if approved_site.deleted_at is not None:
                    stop_at = approved_site.deleted_at
                elif not approved_site.enabled:
                    stop_at = approved_site.paused_at

                if stop_at is not None and ended > stop_at:
                    ended = stop_at

            if ended < started:
                continue

            retention_cutoff = (
                datetime.now(timezone.utc)
                - timedelta(days=SESSION_RETENTION_DAYS)
            )

            if ended < retention_cutoff:
                expired += 1
                continue

            duration = min(
                max(0, int(item.durationSeconds)),
                max(
                    0,
                    int((ended - started).total_seconds()),
                ),
            )

            if duration <= 0:
                continue

            session = StudySession(
                user_id=user.id,
                group_id=item.group_id,
                topic=item.subject.strip() or "General",
                domain=host,
                duration_seconds=duration,
                started_at=started,
                ended_at=ended,
                site_url="https://" + host,
                site_title=item.title or host,
                source_session_id=item.id,
            )

            db.add(session)
            saved += 1

        db.commit()

        return {
            "saved": saved,
            "expired": expired,
            "unapproved": unapproved,
            "duplicates": duplicates,
        }

    except Exception:
        db.rollback()
        logger.exception("Website session sync failed")
        raise HTTPException(
            status_code=500,
            detail="Website session sync failed. Check backend logs.",
        )

@app.get("/sessions")
def list_sessions(
    limit: int = Query(
        100,
        ge=1,
        le=500,
    ),
    group_id: Optional[int] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(
        group_id,
        user,
        db,
    )

    query = select(StudySession).where(
        StudySession.user_id == user.id,
        StudySession.group_id == group_id,
    )

    query = (
        query
        .order_by(StudySession.started_at.desc())
        .limit(limit)
    )

    return [
        session_json(session)
        for session in db.scalars(query).all()
    ]


@app.delete("/sessions/{session_id}")
def delete_manual_session(
    session_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """
    Delete only a manually entered dashboard session.

    Website-tracked sessions and extension-synced sessions have a source
    session ID and/or a website URL, so they cannot be deleted through
    this endpoint.
    """
    session = db.scalar(
        select(StudySession).where(
            StudySession.id == session_id,
            StudySession.user_id == user.id,
            StudySession.source_session_id.is_(None),
            StudySession.site_url.is_(None),
        )
    )

    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Manual study session not found or cannot be deleted.",
        )

    db.delete(session)
    db.commit()

    return {
        "success": True,
        "deleted_session_id": session_id,
    }


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
    workspace_group(
        data.group_id,
        user,
        db,
    )

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


@app.post("/notes/append")
def append_topic_note(
    data: NoteAppendIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(
        data.group_id,
        user,
        db,
    )

    existing_event = db.scalar(
        select(NoteAppendEvent).where(
            NoteAppendEvent.user_id == user.id,
            NoteAppendEvent.source_note_id == data.source_note_id,
        )
    )

    if existing_event:
        existing_page = db.get(
            NotePage,
            existing_event.note_page_id,
        )

        if existing_page:
            return {
                **note_json(existing_page),
                "appended": False,
            }

    topic = data.topic.strip()
    domain = data.domain.strip() or "General"

    notebook_title = (
        f"{topic} Notes"
        if domain == "General"
        else f"{topic} - {domain} Notes"
    )

    notebook = db.scalar(
        select(NotePage)
        .where(
            NotePage.group_id == data.group_id,
            NotePage.topic == topic,
            NotePage.domain == domain,
            NotePage.title == notebook_title,
        )
        .order_by(NotePage.id)
    )

    if notebook is None:
        notebook = NotePage(
            user_id=user.id,
            group_id=data.group_id,
            topic=topic,
            domain=domain,
            title=notebook_title,
            content="",
        )

        db.add(notebook)
        db.flush()

    captured_at = datetime.now(
        timezone.utc
    ).isoformat(timespec="minutes")

    source = (
        f"\nSource: {data.source_url}"
        if data.source_url
        else ""
    )

    entry = (
        f"[{captured_at}] "
        f"{data.title.strip() or 'Saved selection'}\n"
        f"{data.content.strip()}{source}"
    )

    notebook.content = (
        f"{notebook.content.rstrip()}\n\n---\n\n{entry}"
        if notebook.content.strip()
        else entry
    )

    notebook.updated_at = datetime.now(timezone.utc)

    db.add(
        NoteAppendEvent(
            user_id=user.id,
            source_note_id=data.source_note_id,
            note_page_id=notebook.id,
        )
    )

    db.commit()
    db.refresh(notebook)

    return {
        **note_json(notebook),
        "appended": True,
    }


@app.get("/notes")
def list_notes(
    search: str = "",
    group_id: Optional[int] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(
        group_id,
        user,
        db,
    )

    query = select(NotePage).where(
        NotePage.group_id == group_id
    )

    if group_id is None:
        query = query.where(
            NotePage.user_id == user.id
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

    return [
        {
            **note_json(note),
            "can_edit": note.user_id == user.id,
        }
        for note in notes
    ]


@app.put("/notes/{note_id}")
def update_note(
    note_id: int,
    data: NoteUpdate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    note = db.get(
        NotePage,
        note_id,
    )

    if note is None or note.user_id != user.id:
        raise HTTPException(
            status_code=404,
            detail="Note not found.",
        )

    updates = data.model_dump(
        exclude_unset=True
    )

    for key, value in updates.items():
        if value is not None:
            if isinstance(value, str):
                value = (
                    value.strip()
                    if key != "content"
                    else value
                )

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
    note = db.get(
        NotePage,
        note_id,
    )

    if note is None or note.user_id != user.id:
        raise HTTPException(
            status_code=404,
            detail="Note not found.",
        )

    db.delete(note)
    db.commit()

    return {
        "ok": True,
    }


# ============================================================
# DASHBOARD
# ============================================================

@app.get("/dashboard/summary")
def dashboard(
    group_id: Optional[int] = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(
        group_id,
        user,
        db,
    )

    query = select(StudySession).where(
        StudySession.user_id == user.id,
        StudySession.group_id == group_id,
    )

    sessions = db.scalars(query).all()

    today = india_today()

    week_start = today - timedelta(days=6)

    history_start = today - timedelta(
        days=SESSION_RETENTION_DAYS - 1
    )

    daily_totals = {}

    for session in sessions:
        session_day = to_india_datetime(
            session.started_at
        ).date()

        if history_start <= session_day <= today:
            daily_totals[session_day] = (
                daily_totals.get(session_day, 0)
                + session.duration_seconds
            )

    today_seconds = daily_totals.get(
        today,
        0,
    )

    weekly = []

    for offset in range(7):
        day = week_start + timedelta(days=offset)

        weekly.append({
            "date": day.isoformat(),
            "seconds": daily_totals.get(day, 0),
        })

    daily_study = [
        {
            "date": (
                history_start + timedelta(days=offset)
            ).isoformat(),

            "seconds": daily_totals.get(
                history_start + timedelta(days=offset),
                0,
            ),
        }
        for offset in range(SESSION_RETENTION_DAYS)
    ]

    streak_cursor = (
        today
        if daily_totals.get(today, 0) > 0
        else today - timedelta(days=1)
    )

    current_streak = 0

    while (
        streak_cursor >= history_start
        and daily_totals.get(streak_cursor, 0) > 0
    ):
        current_streak += 1
        streak_cursor -= timedelta(days=1)

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
        "daily_study": daily_study,
        "current_streak": current_streak,
        "history_days": SESSION_RETENTION_DAYS,
    }


# ============================================================
# GROUP DATE ROUNDS AND MONTHLY WINNERS
# ============================================================


@app.get("/groups/{group_id}/activity/today")
def group_activity_today(
    group_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Return today's completed study activity for every member of a group.

    The date boundary is calculated in Asia/Kolkata and converted to UTC,
    matching the timezone used by StudyTrack's dashboard and competition.
    """
    workspace_group(group_id, user, db)

    today = india_today()
    local_start = datetime.combine(
        today,
        datetime.min.time(),
        tzinfo=INDIA_TZ,
    )
    local_end = local_start + timedelta(days=1)
    start_utc = local_start.astimezone(timezone.utc)
    end_utc = local_end.astimezone(timezone.utc)

    member_rows = db.execute(
        select(User.id, User.name)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.group_id == group_id)
        .order_by(User.name.asc())
    ).all()

    members = {
        member_id: {
            "user_id": member_id,
            "name": member_name,
            "total_seconds": 0,
            "sessions_count": 0,
            "topics": {},
        }
        for member_id, member_name in member_rows
    }

    session_rows = db.execute(
        select(StudySession, User.name)
        .join(User, User.id == StudySession.user_id)
        .where(
            StudySession.group_id == group_id,
            StudySession.started_at >= start_utc,
            StudySession.started_at < end_utc,
        )
        .order_by(StudySession.started_at.desc())
    ).all()

    recent_activity = []
    total_seconds = 0

    for session, member_name in session_rows:
        seconds = max(0, int(session.duration_seconds or 0))
        topic_name = (session.topic or "General").strip() or "General"
        domain_name = (session.domain or "General").strip() or "General"
        member = members.get(session.user_id)

        # A session is included only if its owner is still a member of this group.
        if member is None:
            continue

        member["total_seconds"] += seconds
        member["sessions_count"] += 1
        total_seconds += seconds

        # Aggregate by topic name only. Multiple short sessions, domains, or
        # browser visits for the same topic become one combined daily total.
        topic_key = topic_name.casefold()
        topic = member["topics"].setdefault(
            topic_key,
            {
                "topic": topic_name,
                "total_seconds": 0,
                "sessions_count": 0,
            },
        )
        topic["total_seconds"] += seconds
        topic["sessions_count"] += 1

        started_local = to_india_datetime(session.started_at)
        recent_activity.append({
            "id": session.id,
            "user_id": session.user_id,
            "member_name": member_name,
            "topic": topic_name,
            "domain": domain_name,
            "duration_seconds": seconds,
            "started_at": started_local.isoformat(),
            "site_title": session.site_title or session.site_url or domain_name,
            "site_url": session.site_url,
        })

    member_list = []
    for member in members.values():
        topic_list = sorted(
            member["topics"].values(),
            key=lambda item: (-item["total_seconds"], item["topic"].lower()),
        )
        member["topics"] = topic_list
        member_list.append(member)

    member_list.sort(
        key=lambda item: (-item["total_seconds"], item["name"].lower())
    )

    return {
        "group_id": group_id,
        "date": today.isoformat(),
        "timezone": "Asia/Kolkata",
        "total_seconds": total_seconds,
        "sessions_count": len(recent_activity),
        "members_count": len(member_list),
        "active_members_count": sum(
            1 for member in member_list if member["total_seconds"] > 0
        ),
        "members": member_list,
        "recent_activity": recent_activity[:20],
        "updated_at": india_now().isoformat(),
    }


@app.get("/groups/{group_id}/leaderboard")
def leaderboard(
    group_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(
        group_id,
        user,
        db,
    )

    group = db.get(
        StudyGroup,
        group_id,
    )

    if group is None:
        raise HTTPException(
            status_code=404,
            detail="Group not found.",
        )

    finalize_completed_rounds(
        group,
        db,
    )

    finalize_completed_months(
        group,
        db,
    )

    today = india_today()

    start, end = period_for(today)

    rows = group_period_rows(
        group_id,
        start,
        end,
        db,
    )

    month_start, month_end = month_for(today)

    monthly_winner = db.scalar(
        select(CompetitionWinner).where(
            CompetitionWinner.group_id == group_id,
            CompetitionWinner.period_start == month_start,
            CompetitionWinner.period_end == month_end,
        )
    )

    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "month_start": month_start.isoformat(),
        "month_end": month_end.isoformat(),
        "leaderboard": rows,
        "month_winner": (
            None
            if monthly_winner is None
            else {
                "name": monthly_winner.winner_name,
                "seconds": monthly_winner.winning_seconds,
            }
        ),
    }


@app.post("/groups/{group_id}/finalize-current-period")
def finalize_period(
    group_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    group = db.get(
        StudyGroup,
        group_id,
    )

    if group is None or group.created_by != user.id:
        raise HTTPException(
            status_code=403,
            detail="Only the group creator can finalize a competition period.",
        )

    current_month_start, _ = month_for(
        india_today()
    )

    previous_month_day = (
        current_month_start - timedelta(days=1)
    )

    start, end = month_for(
        previous_month_day
    )

    existing = db.scalar(
        select(CompetitionWinner).where(
            CompetitionWinner.group_id == group_id,
            CompetitionWinner.period_start == start,
        )
    )

    record = save_month_winner(
        group_id,
        start,
        end,
        db,
    )

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
    workspace_group(
        group_id,
        user,
        db,
    )

    group = db.get(
        StudyGroup,
        group_id,
    )

    if group is None:
        raise HTTPException(
            status_code=404,
            detail="Group not found.",
        )

    finalize_completed_months(
        group,
        db,
    )

    stored_records = db.scalars(
        select(CompetitionWinner)
        .where(
            CompetitionWinner.group_id == group_id
        )
        .order_by(
            CompetitionWinner.period_start.desc()
        )
    ).all()

    records = [
        record
        for record in stored_records
        if month_for(record.period_start)[1]
        == record.period_end
    ][:4]

    return [
        {
            "period_start": record.period_start.isoformat(),
            "period_end": record.period_end.isoformat(),
            "winner": record.winner_name,
            "seconds": record.winning_seconds,
        }
        for record in records
    ]


@app.get("/groups/{group_id}/round-winners")
def round_winners(
    group_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    workspace_group(
        group_id,
        user,
        db,
    )

    group = db.get(
        StudyGroup,
        group_id,
    )

    if group is None:
        raise HTTPException(
            status_code=404,
            detail="Group not found.",
        )

    finalize_completed_rounds(
        group,
        db,
    )

    records = db.scalars(
        select(CompetitionRoundWinner)
        .where(
            CompetitionRoundWinner.group_id == group_id
        )
        .order_by(
            CompetitionRoundWinner.period_start.desc()
        )
        .limit(12)
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
# SESSION RETENTION ENDPOINT
# ============================================================

@app.post("/maintenance/cleanup-old-sessions")
def cleanup_old_sessions(
    user: User = Depends(current_user),
):
    return {
        "deleted_sessions": prune_expired_sessions(
            user.id
        ),
        "retention_days": SESSION_RETENTION_DAYS,
    }
