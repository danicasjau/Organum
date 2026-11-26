"""CR04 §6/§8/§11: working hours, activation periods, studio comments and member links."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, utc_now


class UserWorkHours(Base):
    """One working interval on a weekday (1=Mon..7=Sun), minutes from local midnight."""

    __tablename__ = "user_work_hours"
    __table_args__ = (
        CheckConstraint("weekday BETWEEN 1 AND 7", name="ck_work_hours_weekday"),
        CheckConstraint(
            "start_min >= 0 AND end_min <= 1440 AND start_min < end_min",
            name="ck_work_hours_range",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)
    start_min: Mapped[int] = mapped_column(Integer, nullable=False)
    end_min: Mapped[int] = mapped_column(Integer, nullable=False)


class UserWorkException(Base):
    """A dated exception: a day off (no interval) or special hours (one row per interval)."""

    __tablename__ = "user_work_exceptions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    day: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    start_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str] = mapped_column(String(256), default="", nullable=False)


class ActivationPeriod(TimestampMixin, Base):
    """'Active on the project from start to end' for a department, studio/company or user."""

    __tablename__ = "activation_periods"
    __table_args__ = (
        CheckConstraint("start_date <= end_date", name="ck_activation_dates"),
        CheckConstraint(
            "(CASE WHEN department_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN company_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN user_id IS NULL THEN 0 ELSE 1 END) = 1",
            name="ck_activation_single_target",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("departments.id", ondelete="CASCADE"), index=True, nullable=True
    )
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    @property
    def target_kind(self) -> str:
        if self.department_id is not None:
            return "department"
        if self.company_id is not None:
            return "company"
        return "user"

    @property
    def target_id(self) -> uuid.UUID:
        return self.department_id or self.company_id or self.user_id  # type: ignore[return-value]


class CompanyComment(Base):
    """Dated note on a studio / client / group, with its author."""

    __tablename__ = "company_comments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now(), nullable=False
    )


class CompanyMember(Base):
    """Links a person to a studio or group in addition to their primary company."""

    __tablename__ = "company_members"
    __table_args__ = (UniqueConstraint("company_id", "user_id", name="uq_company_member"),)

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
