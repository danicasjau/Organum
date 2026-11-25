from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    app: str
    version: str
    environment: str


class ReadinessResponse(BaseModel):
    status: str
    database: str


class KnownProjectOut(BaseModel):
    uuid: str
    name: str
    path: str
    last_opened: datetime
    exists_on_disk: bool = True


class ProjectCreateRequest(BaseModel):
    path: str
    name: str
    starter_departments: list[str] = Field(
        default_factory=lambda: [
            "Modeling",
            "Rigging",
            "Animation",
            "FX",
            "Lighting",
            "Lookdev",
            "Compositing",
        ]
    )


class ProjectOpenRequest(BaseModel):
    path: str


class FsDirEntryOut(BaseModel):
    name: str
    path: str


class FsBrowseResponse(BaseModel):
    current_path: str
    parent_path: str | None = None
    drives: list[str] = Field(default_factory=list)
    directories: list[FsDirEntryOut] = Field(default_factory=list)


class LauncherItemIn(BaseModel):
    id: UUID | None = None
    extension: str
    label: str
    executable_path: str
    args_template: str = "{file}"
    is_default: bool = True


class LauncherOut(BaseModel):
    id: UUID
    extension: str
    label: str
    executable_path: str
    args_template: str
    is_default: bool


class LaunchersPutRequest(BaseModel):
    launchers: list[LauncherItemIn]


class AutodetectedLauncherOut(BaseModel):
    extension: str
    label: str
    executable_path: str
    args_template: str


class UiPrefOut(BaseModel):
    key: str
    value_json: Any


class UiPrefPutRequest(BaseModel):
    value_json: Any


class DefaultTaskOut(BaseModel):
    id: UUID
    department_id: UUID
    name: str
    folder_name: str
    sort_order: int


class DefaultTaskCreate(BaseModel):
    name: str


class DefaultTaskUpdate(BaseModel):
    name: str | None = None
    sort_order: int | None = None


class DepartmentOut(BaseModel):
    id: UUID
    name: str
    folder_name: str
    sort_order: int
    is_active: bool
    default_tasks: list[DefaultTaskOut] = Field(default_factory=list)


class DepartmentCreate(BaseModel):
    name: str


class DepartmentUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class ReorderRequest(BaseModel):
    ids: list[UUID]


class ReconcileReportOut(BaseModel):
    entities_scanned: int
    entities_created: int
    entities_updated: int
    entities_missing: int
    versions_registered: int
    files_scanned: int
    plain_folders: list[str] = Field(default_factory=list)


class FileSummaryOut(BaseModel):
    id: UUID
    filename: str
    relative_path: str
    size: int
    sha256: str
    detected_format: str
    media_kind: str
    colorspace_override: str | None = None
    is_sequence: bool = False
    sequence_pattern: str | None = None
    sequence_kind: str = "none"
    sequence_kind_user_override: bool = False
    frame_start: int | None = None
    frame_end: int | None = None
    frame_count: int | None = None
    is_missing: bool = False


class ProductVersionOut(BaseModel):
    id: UUID
    version_number: int
    label: str
    rel_path: str
    comment: str
    source_json: list[str] = Field(default_factory=list)
    author_name: str | None = None
    created_at: datetime
    files: list[FileSummaryOut] = Field(default_factory=list)


class ProductOut(BaseModel):
    id: UUID
    task_id: UUID
    name: str
    master_version_id: UUID | None = None
    versions: list[ProductVersionOut] = Field(default_factory=list)


class TaskOut(BaseModel):
    id: UUID
    name: str
    folder_name: str
    sort_order: int
    product: ProductOut | None = None


class EntityDepartmentOut(BaseModel):
    id: UUID
    department_id: UUID
    name: str
    folder_name: str
    sort_order: int
    tasks: list[TaskOut] = Field(default_factory=list)


class EntityOut(BaseModel):
    id: UUID
    name: str
    folder_name: str
    rel_path: str
    entity_type: str | None = None
    description: str | None = None
    thumbnail_file_id: UUID | None = None
    resolved_thumbnail_file_id: UUID | None = None
    thumbnail_source: str = "auto"
    is_missing: bool = False
    tags: list[str] = Field(default_factory=list)
    departments: list[EntityDepartmentOut] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class EntityTreeOut(BaseModel):
    project_uuid: str
    project_name: str
    entities: list[EntityOut] = Field(default_factory=list)
    plain_folders: list[str] = Field(default_factory=list)
    available_types: list[str] = Field(default_factory=list)
    available_tags: list[str] = Field(default_factory=list)
    next_cursor: str | None = None
    total: int = 0


class EntityCreateRequest(BaseModel):
    name: str
    parent_rel_path: str = ""
    entity_type: str | None = None
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    department_ids: list[UUID] = Field(default_factory=list)


class EntityUpdateRequest(BaseModel):
    name: str | None = None
    parent_rel_path: str | None = None
    entity_type: str | None = None
    description: str | None = None


class FolderCreateRequest(BaseModel):
    parent_rel_path: str = ""
    name: str


class FolderPromoteRequest(BaseModel):
    rel_path: str


class EntityTagsPutRequest(BaseModel):
    tags: list[str] = Field(default_factory=list)


class EntityDataItem(BaseModel):
    key: str
    value_type: Literal["str", "int", "float", "bool", "json"] = "str"
    value_text: str = ""


class EntityDataPutRequest(BaseModel):
    items: list[EntityDataItem] = Field(default_factory=list)


class EntityThumbnailPutRequest(BaseModel):
    file_id: UUID | None = None
    source: Literal["auto", "manual", "none"] = "manual"


class EntityDepartmentAddRequest(BaseModel):
    department_id: UUID


class TaskCreateRequest(BaseModel):
    name: str


class TaskUpdateRequest(BaseModel):
    name: str | None = None
    sort_order: int | None = None


class PublishScenefilesRequest(BaseModel):
    scenefile_rel_paths: list[str]
    comment: str = ""
    set_master: bool | None = None


class ProductMasterPutRequest(BaseModel):
    version_id: UUID


class SceneEntryOut(BaseModel):
    name: str
    rel_path: str
    project_rel_path: str
    is_dir: bool
    size: int
    mtime: float
    extension: str
    is_image: bool
    is_media: bool
    thumb_url: str | None = None


class SceneListResponse(BaseModel):
    current_path: str
    parent_path: str | None = None
    entries: list[SceneEntryOut] = Field(default_factory=list)


class SceneMkdirRequest(BaseModel):
    path: str = ""
    name: str


class SceneRenameRequest(BaseModel):
    rel_path: str
    new_name: str


class SceneMoveRequest(BaseModel):
    rel_paths: list[str]
    dest_dir: str = ""


class SceneDeleteRequest(BaseModel):
    rel_paths: list[str]


class LaunchRequest(BaseModel):
    rel_path: str
    launcher_id: UUID | None = None


class RevealRequest(BaseModel):
    rel_path: str


class LaunchResponse(BaseModel):
    launched: bool
    method: str
    target: str


class AnnotationCreate(BaseModel):
    kind: str = Field(pattern="^(2d|3d|audio)$")
    coord_space: str = Field(default="image", pattern="^(image|uv|plane|world)$")
    frame_in: int | None = None
    frame_out: int | None = None
    time_base: float | None = None
    note_text: str = ""
    vector_json: list[dict[str, Any]] = Field(default_factory=list)
    plane_json: dict[str, Any] | None = None
    camera_json: dict[str, Any] | None = None


class AnnotationUpdate(BaseModel):
    coord_space: str | None = Field(default=None, pattern="^(image|uv|plane|world)$")
    frame_in: int | None = None
    frame_out: int | None = None
    time_base: float | None = None
    note_text: str | None = None
    vector_json: list[dict[str, Any]] | None = None
    plane_json: dict[str, Any] | None = None
    camera_json: dict[str, Any] | None = None


class AnnotationOut(BaseModel):
    id: UUID
    file_id: UUID
    kind: str
    coord_space: str = "image"
    frame_in: int | None
    frame_out: int | None
    time_base: float | None
    note_text: str
    vector_json: list[dict[str, Any]]
    plane_json: dict[str, Any] | None
    camera_json: dict[str, Any] | None
    author_id: UUID | None
    created_at: datetime
    updated_at: datetime


class ColorspaceInfo(BaseModel):
    id: str
    label: str
    category: str
    is_default: bool = False


class ColorspaceListResponse(BaseModel):
    input_spaces: list[ColorspaceInfo]
    display_views: list[ColorspaceInfo]
    ocio_version: str | None = None
    ocio_config: str | None = None


class LutResponse(BaseModel):
    src: str
    dst: str
    size: int
    engine: str
    config_name: str
    cache_key: str
    values: list[float]


class FilePatchRequest(BaseModel):
    colorspace_override: str | None = None
    sequence_kind: Literal["none", "frames", "udim", "auto"] | None = None
    sequence_kind_user_override: bool | None = None


class ArtifactRequest(BaseModel):
    params: dict[str, Any] = Field(default_factory=dict)


class ArtifactOut(BaseModel):
    id: UUID
    file_id: UUID
    kind: str
    handler_id: str
    handler_version: str
    cache_key: str
    mime_type: str
    size: int
    status: str
    content_url: str
