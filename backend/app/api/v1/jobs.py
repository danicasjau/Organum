from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse

from app.core.deps import get_job_runner
from app.core.errors import NotFoundError
from app.jobs.base import JobRunner

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}/events")
async def stream_job_events(
    job_id: UUID,
    runner: Annotated[JobRunner, Depends(get_job_runner)],
) -> EventSourceResponse:
    if runner.get_status(job_id) is None:
        raise NotFoundError("job", str(job_id))

    async def event_generator() -> AsyncIterator[dict[str, str]]:
        async for ev in runner.subscribe(job_id):
            yield {
                "event": ev.status,
                "data": json.dumps(
                    {
                        "job_id": str(ev.job_id),
                        "status": ev.status,
                        "progress": ev.progress,
                        "message": ev.message,
                        "result": ev.result,
                        "error": ev.error,
                    }
                ),
            }

    return EventSourceResponse(event_generator())


@router.post("/{job_id}/cancel")
async def cancel_job(
    job_id: UUID,
    runner: Annotated[JobRunner, Depends(get_job_runner)],
) -> dict[str, bool]:
    cancelled = await runner.cancel(job_id)
    return {"cancelled": cancelled}

