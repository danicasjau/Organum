from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.logging import request_id_var


class AppError(Exception):
    """Base domain error rendered into a consistent API error envelope."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details


class NotFoundError(AppError):
    def __init__(self, resource: str, identifier: str) -> None:
        super().__init__(
            code="not_found",
            message=f"{resource} '{identifier}' not found",
            status_code=404,
            details={"resource": resource, "id": identifier},
        )


class ConflictError(AppError):
    def __init__(self, message: str, details: Any = None) -> None:
        super().__init__(
            code="conflict",
            message=message,
            status_code=409,
            details=details,
        )


def _error_envelope(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "request_id": request_id_var.get(),
        }
    }


def register_exception_handlers(app: FastAPI) -> None:
    """Attach structured error handlers to the FastAPI application."""

    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_envelope(exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=_error_envelope(
                "validation_error",
                "Request validation failed",
                exc.errors(),
            ),
        )

