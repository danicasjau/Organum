from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID


@dataclass
class JobProgressEvent:
    job_id: UUID
    status: str
    progress: float
    message: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None


JobReporter = Callable[[float, str], Awaitable[None]]
JobCoroFactory = Callable[[JobReporter], Awaitable[dict[str, Any] | None]]


@dataclass
class JobRecord:
    id: UUID
    kind: str
    status: str = "queued"
    progress: float = 0.0
    message: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None
    subscribers: list[Any] = field(default_factory=list)


class JobRunner(ABC):
    """Port for running and tracking background jobs."""

    @abstractmethod
    async def submit(self, job_id: UUID, kind: str, work: JobCoroFactory) -> JobRecord:
        """Schedule a job and return its initial state."""

    @abstractmethod
    async def cancel(self, job_id: UUID) -> bool:
        """Cancel a running or queued job."""

    @abstractmethod
    def get_status(self, job_id: UUID) -> JobRecord | None:
        """Return latest in-memory job record if tracked."""

    @abstractmethod
    def subscribe(self, job_id: UUID) -> AsyncIterator[JobProgressEvent]:
        """Yield progress updates until the job completes or fails."""

    @abstractmethod
    async def shutdown(self) -> None:
        """Gracefully stop running jobs and executors."""
