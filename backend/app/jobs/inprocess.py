from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from concurrent.futures import ProcessPoolExecutor
from typing import Any, TypeVar
from uuid import UUID

from app.jobs.base import JobCoroFactory, JobProgressEvent, JobRecord, JobRunner

T = TypeVar("T")


class InProcessRunner(JobRunner):
    """Asyncio + ProcessPool job runner for single-node deployments."""

    def __init__(self, max_workers: int = 2) -> None:
        self._records: dict[UUID, JobRecord] = {}
        self._tasks: dict[UUID, asyncio.Task[None]] = {}
        self._pool = ProcessPoolExecutor(max_workers=max_workers)

    async def run_cpu_bound(self, fn: Callable[..., T], *args: Any) -> T:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._pool, fn, *args)

    async def _broadcast(self, record: JobRecord) -> None:
        event = JobProgressEvent(
            job_id=record.id,
            status=record.status,
            progress=record.progress,
            message=record.message,
            result=record.result,
            error=record.error,
        )
        for q in list(record.subscribers):
            await q.put(event)

    async def submit(self, job_id: UUID, kind: str, work: JobCoroFactory) -> JobRecord:
        record = JobRecord(id=job_id, kind=kind, status="queued", progress=0.0)
        self._records[job_id] = record

        async def _runner() -> None:
            record.status = "running"
            await self._broadcast(record)

            async def _report(progress: float, message: str = "") -> None:
                record.progress = max(0.0, min(1.0, progress))
                record.message = message
                await self._broadcast(record)

            try:
                result = await work(_report)
                record.status = "completed"
                record.progress = 1.0
                record.result = result
            except asyncio.CancelledError:
                record.status = "cancelled"
                record.message = "Cancelled"
                raise
            except Exception as exc:
                record.status = "failed"
                record.error = str(exc)
            finally:
                await self._broadcast(record)

        self._tasks[job_id] = asyncio.create_task(_runner())
        return record

    async def cancel(self, job_id: UUID) -> bool:
        task = self._tasks.get(job_id)
        if task is None or task.done():
            return False
        task.cancel()
        return True

    def get_status(self, job_id: UUID) -> JobRecord | None:
        return self._records.get(job_id)

    async def subscribe(self, job_id: UUID) -> AsyncIterator[JobProgressEvent]:
        record = self._records.get(job_id)
        if record is None:
            return
        queue: asyncio.Queue[JobProgressEvent] = asyncio.Queue()
        record.subscribers.append(queue)
        try:
            yield JobProgressEvent(
                job_id=record.id,
                status=record.status,
                progress=record.progress,
                message=record.message,
                result=record.result,
                error=record.error,
            )
            while record.status in ("queued", "running"):
                event = await queue.get()
                yield event
                if event.status not in ("queued", "running"):
                    break
        finally:
            if queue in record.subscribers:
                record.subscribers.remove(queue)

    async def shutdown(self) -> None:
        for task in list(self._tasks.values()):
            if not task.done():
                task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        self._pool.shutdown(wait=False, cancel_futures=True)

