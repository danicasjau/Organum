from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.admin_routes import router as admin_router
from app.api.v1.annotations import router as annotations_router
from app.api.v1.app_routes import router as app_router
from app.api.v1.artifacts import router as artifacts_router
from app.api.v1.auth_routes import global_auth_router, project_auth_router
from app.api.v1.calendar_routes import router as calendar_router
from app.api.v1.colorspaces import router as colorspaces_router
from app.api.v1.confo_routes import router as confo_router
from app.api.v1.departments import router as departments_router
from app.api.v1.entity_links_routes import router as entity_links_router
from app.api.v1.files import router as files_router
from app.api.v1.jobs import router as jobs_router
from app.api.v1.launch import router as launch_router
from app.api.v1.people_routes import router as people_router
from app.api.v1.products_api import router as products_router
from app.api.v1.project_entities import router as project_entities_router
from app.api.v1.rules_routes import router as rules_router
from app.api.v1.scenefiles import router as scenefiles_router
from app.api.v1.schedule_routes import router as schedule_router
from app.api.v1.tasks_routes import router as tasks_router
from app.api.v1.users_routes import router as users_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(global_auth_router)
api_router.include_router(app_router)
api_router.include_router(colorspaces_router)
api_router.include_router(jobs_router)

project_router = APIRouter(prefix="/projects/{project_uuid}")
project_router.include_router(project_auth_router)
project_router.include_router(users_router)
project_router.include_router(admin_router)
project_router.include_router(departments_router)
project_router.include_router(project_entities_router)
project_router.include_router(tasks_router)
project_router.include_router(entity_links_router)
project_router.include_router(rules_router)
project_router.include_router(confo_router)
project_router.include_router(people_router)
project_router.include_router(schedule_router)
project_router.include_router(calendar_router)
project_router.include_router(products_router)
project_router.include_router(scenefiles_router)
project_router.include_router(launch_router)
project_router.include_router(files_router)
project_router.include_router(artifacts_router)
project_router.include_router(annotations_router)

api_router.include_router(project_router)
