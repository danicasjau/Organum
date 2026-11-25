from __future__ import annotations

from datetime import date, datetime
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
    needs_lead_review: bool = True
    needs_sup_review: bool = False
    needs_client_review: bool = False
    default_priority: Literal["normal", "high", "stopper"] = "normal"
    default_bid_hours: float | None = None
    default_complexity: int | None = None


class DefaultTaskCreate(BaseModel):
    name: str
    needs_lead_review: bool = True
    needs_sup_review: bool = False
    needs_client_review: bool = False
    default_priority: Literal["normal", "high", "stopper"] = "normal"
    default_bid_hours: float | None = None
    default_complexity: int | None = Field(default=None, ge=1, le=5)


class DefaultTaskUpdate(BaseModel):
    name: str | None = None
    sort_order: int | None = None
    needs_lead_review: bool | None = None
    needs_sup_review: bool | None = None
    needs_client_review: bool | None = None
    default_priority: Literal["normal", "high", "stopper"] | None = None
    default_bid_hours: float | None = None
    default_complexity: int | None = Field(default=None, ge=1, le=5)


class DepartmentOut(BaseModel):
    id: UUID
    name: str
    folder_name: str
    short_code: str = ""
    color: str = "--series-1"
    sort_order: int
    is_active: bool
    default_tasks: list[DefaultTaskOut] = Field(default_factory=list)


class DepartmentCreate(BaseModel):
    name: str
    short_code: str | None = None
    color: str | None = None


class DepartmentUpdate(BaseModel):
    name: str | None = None
    short_code: str | None = None
    color: str | None = None
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


class TaskAssignmentOut(BaseModel):
    user_id: UUID
    username: str
    full_name: str
    avatar_file: str | None = None
    assignment_role: Literal["artist", "lead", "supervisor"]
    source: str = "manual"


class TaskOut(BaseModel):
    id: UUID
    task_code: str = ""
    task_name: str = ""
    name: str
    folder_name: str
    sort_order: int
    status: str | None = None
    priority: str = "normal"
    ideal_finish_date: date | None = None
    bid_hours: float | None = None
    logged_hours: float = 0.0
    blocked_upstream: bool = False
    acted_as: str | None = None
    assignments: list[TaskAssignmentOut] = Field(default_factory=list)
    my_capacities: list[str] = Field(default_factory=list)
    shared_company_ids: list[UUID] = Field(default_factory=list)
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
    # Project-relative path of the listed directory (for "Open in Explorer").
    current_project_rel_path: str | None = None


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
    visibility: Literal["internal", "client"] = "internal"


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
    visibility: Literal["internal", "client"] = "internal"
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


# --- CR03 Phase 7A: Auth, Users, Roles, Capacities, Companies, Shares, Client Allowlist ---


class LoginProjectOption(BaseModel):
    uuid: str
    name: str


class BootstrapInfoOut(BaseModel):
    bootstrap_allowed: bool
    projects: list[LoginProjectOption] = Field(default_factory=list)


class LoginRequest(BaseModel):
    project_uuid: str
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str | None = None
    new_password: str


class ProjectRefOut(BaseModel):
    project_uuid: str
    project_name: str


class UserOut(BaseModel):
    id: UUID
    username: str
    full_name: str
    email: str | None = None
    role_id: UUID
    role_name: str
    role_label: str
    company_id: UUID | None = None
    company_name: str | None = None
    avatar_file: str | None = None
    daily_capacity_hours: float = 8.0
    timezone: str = "UTC"
    is_active: bool = True
    must_change_password: bool = False
    last_login_at: datetime | None = None
    department_ids: list[UUID] = Field(default_factory=list)
    projects_working_on: list[ProjectRefOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class AuthUserSummaryOut(BaseModel):
    id: UUID
    username: str
    full_name: str
    email: str | None = None
    role_id: UUID
    role_name: str
    role_label: str
    company_id: UUID | None = None
    avatar_file: str | None = None
    daily_capacity_hours: float
    timezone: str
    is_active: bool
    must_change_password: bool
    department_ids: list[UUID] = Field(default_factory=list)
    projects_working_on: list[ProjectRefOut] = Field(default_factory=list)


class AuthMeOut(BaseModel):
    user: AuthUserSummaryOut
    project_uuid: str
    project_status: str
    permissions: dict[str, str]
    capacity_permissions: dict[str, list[str]]


class UserCreateRequest(BaseModel):
    username: str
    full_name: str
    email: str | None = None
    password: str
    role_id: UUID
    company_id: UUID | None = None
    daily_capacity_hours: float = Field(default=8.0, ge=0.0, le=24.0)
    timezone: str = "UTC"
    department_ids: list[UUID] = Field(default_factory=list)
    must_change_password: bool = True


class UserUpdateRequest(BaseModel):
    full_name: str | None = None
    email: str | None = None
    role_id: UUID | None = None
    company_id: UUID | None = None
    daily_capacity_hours: float | None = Field(default=None, ge=0.0, le=24.0)
    timezone: str | None = None
    is_active: bool | None = None


class UserResetPasswordRequest(BaseModel):
    new_password: str
    must_change_password: bool = True


class UserDepartmentsPutRequest(BaseModel):
    department_ids: list[UUID] = Field(default_factory=list)


class CompanyOut(BaseModel):
    id: UUID
    name: str
    short_code: str
    kind: Literal["internal", "external", "group"]
    color: str
    notes: str
    department_ids: list[UUID] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class CompanyCreateRequest(BaseModel):
    name: str
    short_code: str
    kind: Literal["internal", "external", "group"] = "internal"
    color: str = "--series-1"
    notes: str = ""
    department_ids: list[UUID] = Field(default_factory=list)


class CompanyUpdateRequest(BaseModel):
    name: str | None = None
    short_code: str | None = None
    kind: Literal["internal", "external", "group"] | None = None
    color: str | None = None
    notes: str | None = None


class CompanyDepartmentsPutRequest(BaseModel):
    department_ids: list[UUID] = Field(default_factory=list)


class RoleOut(BaseModel):
    id: UUID
    name: str
    label: str
    rank: int
    is_system: bool
    permissions: dict[str, str] = Field(default_factory=dict)


class RoleCreateRequest(BaseModel):
    name: str
    label: str
    rank: int = 30


class RoleUpdateRequest(BaseModel):
    label: str | None = None
    rank: int | None = None


class RolePermissionsPutRequest(BaseModel):
    permissions: dict[str, Literal["all", "company", "mine", "shared", "none"]]


class CapacityPermissionsOut(BaseModel):
    artist: list[str] = Field(default_factory=list)
    lead: list[str] = Field(default_factory=list)
    supervisor: list[str] = Field(default_factory=list)


class CapacityPermissionsPutRequest(BaseModel):
    artist: list[str]
    lead: list[str]
    supervisor: list[str]


class ProjectSettingsOut(BaseModel):
    uuid: str
    name: str
    status: Literal["active", "on_hold", "completed", "archived"]
    hours_per_day: float
    working_days: list[int]
    task_code_pattern: str
    require_version_to_submit: bool
    enforce_dependencies_in_gantt: bool
    admin_sql_console_enabled: bool
    link_dependency_depth: int


class ProjectSettingsPatchRequest(BaseModel):
    name: str | None = None
    status: Literal["active", "on_hold", "completed", "archived"] | None = None
    hours_per_day: float | None = Field(default=None, gt=0.0, le=24.0)
    working_days: list[int] | None = None
    task_code_pattern: str | None = None
    require_version_to_submit: bool | None = None
    enforce_dependencies_in_gantt: bool | None = None
    admin_sql_console_enabled: bool | None = None
    link_dependency_depth: int | None = Field(default=None, ge=1, le=2)


class AuditLogOut(BaseModel):
    id: UUID
    at: datetime
    user_id: UUID | None = None
    username: str | None = None
    action: str
    target_type: str | None = None
    target_id: str | None = None
    ip: str | None = None
    detail_json: dict[str, Any] = Field(default_factory=dict)


class TaskAssignmentItemIn(BaseModel):
    user_id: UUID
    assignment_role: Literal["artist", "lead", "supervisor"]


class TaskAssignmentsPutRequest(BaseModel):
    assignments: list[TaskAssignmentItemIn] = Field(default_factory=list)


class TaskSharesPutRequest(BaseModel):
    company_ids: list[UUID] = Field(default_factory=list)
    version_ids: list[UUID] | None = None
    comment: str | None = None


class VersionSharesPutRequest(BaseModel):
    company_ids: list[UUID] = Field(default_factory=list)


# Dedicated client-only allowlist serializers (§15)
class ClientFileSummaryOut(BaseModel):
    id: UUID
    filename: str
    relative_path: str
    size: int
    sha256: str
    detected_format: str
    media_kind: str
    is_sequence: bool = False
    sequence_pattern: str | None = None
    sequence_kind: str = "none"
    frame_start: int | None = None
    frame_end: int | None = None
    frame_count: int | None = None


class ClientProductVersionOut(BaseModel):
    id: UUID
    version_number: int
    label: str
    comment: str
    created_at: datetime
    files: list[ClientFileSummaryOut] = Field(default_factory=list)


class ClientProductOut(BaseModel):
    id: UUID
    task_id: UUID
    name: str
    master_version_id: UUID | None = None
    versions: list[ClientProductVersionOut] = Field(default_factory=list)


class ClientTaskOut(BaseModel):
    id: UUID
    name: str
    status: str | None = None
    product: ClientProductOut | None = None


class ClientEntityDepartmentOut(BaseModel):
    id: UUID
    department_id: UUID
    name: str
    tasks: list[ClientTaskOut] = Field(default_factory=list)


class ClientEntityOut(BaseModel):
    id: UUID
    name: str
    entity_type: str | None = None
    description: str | None = None
    resolved_thumbnail_file_id: UUID | None = None
    departments: list[ClientEntityDepartmentOut] = Field(default_factory=list)


class ClientEntityTreeOut(BaseModel):
    project_uuid: str
    project_name: str
    entities: list[ClientEntityOut] = Field(default_factory=list)
    total: int = 0


# Phase 7B: Tasks, Workflow, Time Logs, Comments, Reviews, Events, Graph, Workload, Entity Links
class TransitionOptionOut(BaseModel):
    to: str
    action: str
    acted_as: str
    on_behalf: bool = False
    requires_comment: bool = False
    requires_version: bool = False


class TaskDependencyIn(BaseModel):
    upstream_task_id: UUID
    threshold: Literal["APP", "PUBLISHED", "ANY_STATUS"] = "APP"
    from_entity_link: bool = False


class TaskDependencyOut(BaseModel):
    task_id: UUID
    upstream_task_id: UUID
    upstream_task_code: str = ""
    upstream_task_name: str = ""
    upstream_entity_name: str = ""
    upstream_department: str = ""
    upstream_status: str = "WTG"
    threshold: str = "APP"
    from_entity_link: bool = False
    satisfied: bool = False


class TaskLinkIn(BaseModel):
    linked_task_id: UUID
    link_type: str | None = None


class TaskLinkOut(BaseModel):
    id: UUID
    task_id: UUID
    linked_task_id: UUID
    linked_task_code: str = ""
    linked_task_status: str = ""
    link_type: str | None = None


class TimeLogCreateRequest(BaseModel):
    work_date: date | None = None
    hours: float = Field(gt=0.0, le=24.0)
    note: str = ""


class TimeLogOut(BaseModel):
    id: UUID
    task_id: UUID
    user_id: UUID | None = None
    username: str | None = None
    full_name: str | None = None
    work_date: date
    hours: float
    note: str
    created_at: datetime


class TaskCommentCreateRequest(BaseModel):
    body: str = Field(min_length=1)
    parent_id: UUID | None = None
    kind: Literal["note", "review", "media"] = "note"
    visibility: Literal["internal", "client"] = "internal"
    version_id: UUID | None = None
    file_id: UUID | None = None
    annotation_id: UUID | None = None
    frame: int | None = None


class TaskCommentOut(BaseModel):
    id: UUID
    task_id: UUID
    author_id: UUID | None = None
    author_username: str | None = None
    author_full_name: str | None = None
    parent_id: UUID | None = None
    kind: str
    visibility: Literal["internal", "client"]
    body: str
    version_id: UUID | None = None
    file_id: UUID | None = None
    annotation_id: UUID | None = None
    frame: int | None = None
    review_decision: str | None = None
    created_at: datetime
    edited_at: datetime | None = None


class TaskReviewOut(BaseModel):
    id: UUID
    task_id: UUID
    round_no: int
    version_id: UUID | None = None
    version_label: str | None = None
    stage: Literal["lead", "sup", "client"]
    decision: Literal["pending", "approved", "retake"]
    reviewer_id: UUID | None = None
    reviewer_name: str | None = None
    acted_as: str
    on_behalf_of: str | None = None
    comment_id: UUID | None = None
    created_at: datetime


class TaskEventOut(BaseModel):
    id: UUID
    task_id: UUID
    at: datetime
    user_id: UUID | None = None
    username: str | None = None
    acted_as: str
    source: Literal["user", "rule", "system"]
    field: str
    old_value: str | None = None
    new_value: str | None = None


class TaskListItemOut(BaseModel):
    id: UUID
    task_code: str
    task_name: str
    name: str
    folder_name: str
    entity_id: UUID
    entity_name: str
    entity_rel_path: str
    parent_entity_type: str | None = None
    department_id: UUID
    department_name: str
    department_short_code: str = ""
    department_color: str = "--series-1"
    description: str = ""
    status: str
    status_before_hold: str | None = None
    priority: Literal["normal", "high", "stopper"] = "normal"
    needs_lead_review: bool = True
    needs_sup_review: bool = False
    needs_client_review: bool = False
    complexity_rating: int | None = None
    ideal_start_date: date | None = None
    actual_start_date: date | None = None
    ideal_finish_date: date | None = None
    actual_finish_date: date | None = None
    bid_hours: float | None = None
    bid_days: float | None = None
    logged_hours: float = 0.0
    retake_count: int = 0
    latest_version_id: UUID | None = None
    approved_version_id: UUID | None = None
    version_count: int = 0
    upstream_count: int = 0
    blocked_upstream: bool = False
    assignments: list[TaskAssignmentOut] = Field(default_factory=list)
    my_capacities: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    shared_company_ids: list[UUID] = Field(default_factory=list)
    updated_at: datetime
    # Latest review feedback (decision or comment) left by someone other than the caller.
    last_feedback_at: datetime | None = None
    last_feedback_by: str | None = None
    last_feedback_kind: str | None = None


class TaskListOut(BaseModel):
    items: list[TaskListItemOut] = Field(default_factory=list)
    total: int = 0
    next_cursor: str | None = None


class TaskDetailOut(TaskListItemOut):
    acted_as: str | None = None
    allowed_transitions: list[TransitionOptionOut] = Field(default_factory=list)
    dependencies: list[TaskDependencyOut] = Field(default_factory=list)
    downstream: list[TaskDependencyOut] = Field(default_factory=list)
    links: list[TaskLinkOut] = Field(default_factory=list)
    product: ProductOut | None = None
    reviews: list[TaskReviewOut] = Field(default_factory=list)
    comments: list[TaskCommentOut] = Field(default_factory=list)
    events: list[TaskEventOut] = Field(default_factory=list)
    time_logs: list[TimeLogOut] = Field(default_factory=list)


class TaskCreateFullRequest(BaseModel):
    entity_id: UUID
    department_id: UUID
    name: str = Field(min_length=1)
    description: str = ""
    priority: Literal["normal", "high", "stopper"] | None = None
    needs_lead_review: bool | None = None
    needs_sup_review: bool | None = None
    needs_client_review: bool | None = None
    bid_hours: float | None = Field(default=None, ge=0.0)
    complexity_rating: int | None = Field(default=None, ge=1, le=5)
    ideal_start_date: date | None = None
    ideal_finish_date: date | None = None


class TaskPatchRequest(BaseModel):
    name: str | None = None
    sort_order: int | None = None
    task_code: str | None = None
    task_name: str | None = None
    description: str | None = None
    priority: Literal["normal", "high", "stopper"] | None = None
    needs_lead_review: bool | None = None
    needs_sup_review: bool | None = None
    needs_client_review: bool | None = None
    complexity_rating: int | None = Field(default=None, ge=1, le=5)
    bid_hours: float | None = Field(default=None, ge=0.0)
    ideal_start_date: date | None = None
    ideal_finish_date: date | None = None
    status: str | None = None  # rejected with 400 guiding callers to POST /transition
    expected_updated_at: datetime | None = None


class TaskTransitionRequest(BaseModel):
    to: str
    version_id: UUID | None = None
    comment: str | None = None


class TaskDependenciesPutRequest(BaseModel):
    dependencies: list[TaskDependencyIn] = Field(default_factory=list)


class TaskLinksPutRequest(BaseModel):
    links: list[TaskLinkIn] = Field(default_factory=list)


class TaskTagsPutRequest(BaseModel):
    tags: list[str] = Field(default_factory=list)


class TaskBulkRowIn(BaseModel):
    task_id: UUID
    status: str | None = None
    comment: str | None = None
    priority: Literal["normal", "high", "stopper"] | None = None
    assignee_user_ids: list[UUID] | None = None
    assignee_role: Literal["artist", "lead", "supervisor"] = "artist"


class TaskBulkRequest(BaseModel):
    dry_run: bool = True
    rows: list[TaskBulkRowIn] = Field(default_factory=list)


class TaskBulkRowResult(BaseModel):
    task_id: UUID
    task_code: str = ""
    ok: bool
    changes: list[str] = Field(default_factory=list)
    error: str | None = None


class TaskBulkResponse(BaseModel):
    dry_run: bool
    applied: bool
    ok_count: int
    error_count: int
    results: list[TaskBulkRowResult] = Field(default_factory=list)


class TaskGraphNodeOut(BaseModel):
    id: UUID
    task_code: str
    task_name: str
    status: str
    entity_name: str
    department_name: str
    department_color: str
    assignees: list[TaskAssignmentOut] = Field(default_factory=list)


class TaskGraphEdgeOut(BaseModel):
    source_task_id: UUID
    target_task_id: UUID
    kind: Literal["dependency", "link"]
    threshold: str | None = None
    from_entity_link: bool = False


class TaskGraphOut(BaseModel):
    nodes: list[TaskGraphNodeOut] = Field(default_factory=list)
    edges: list[TaskGraphEdgeOut] = Field(default_factory=list)
    truncated: bool = False


class WorkloadCellSchema(BaseModel):
    day: date
    hours: float
    capacity_hours: float
    utilization_pct: float
    contributing_task_ids: list[UUID] = Field(default_factory=list)


class WorkloadRowSchema(BaseModel):
    user_id: UUID
    username: str
    full_name: str
    daily_capacity_hours: float
    cells: list[WorkloadCellSchema] = Field(default_factory=list)


class WorkloadResponse(BaseModel):
    days: list[date] = Field(default_factory=list)
    rows: list[WorkloadRowSchema] = Field(default_factory=list)
    unscheduled_tasks: list[TaskListItemOut] = Field(default_factory=list)


class ReviewQueueItemOut(BaseModel):
    task_id: UUID
    task_code: str
    task_name: str
    entity_id: UUID
    entity_name: str
    department_name: str
    status: str
    submitted_version_id: UUID | None = None
    submitted_version_label: str | None = None
    thumbnail_file_id: UUID | None = None
    submitter_name: str | None = None
    submitted_at: datetime
    wait_hours: float
    can_act_as: str
    on_behalf: bool = False


class MyTasksResponse(BaseModel):
    tasks: list[TaskListItemOut] = Field(default_factory=list)
    to_review: list[ReviewQueueItemOut] = Field(default_factory=list)


# Client-safe Task allowlist serializers (§15)
class ClientTaskCommentOut(BaseModel):
    id: UUID
    task_id: UUID
    author_full_name: str | None = None
    kind: str
    visibility: Literal["client"] = "client"
    body: str
    version_id: UUID | None = None
    file_id: UUID | None = None
    frame: int | None = None
    review_decision: str | None = None
    created_at: datetime


class ClientTaskReviewOut(BaseModel):
    id: UUID
    round_no: int
    version_id: UUID | None = None
    stage: Literal["lead", "sup", "client"]
    decision: Literal["pending", "approved", "retake"]
    created_at: datetime


class ClientTaskListItemOut(BaseModel):
    id: UUID
    task_code: str
    task_name: str
    entity_id: UUID
    entity_name: str
    department_name: str
    status: str
    ideal_finish_date: date | None = None
    description: str = ""
    product: ClientProductOut | None = None


class ClientTaskListOut(BaseModel):
    items: list[ClientTaskListItemOut] = Field(default_factory=list)
    total: int = 0
    next_cursor: str | None = None


class ClientTaskDetailOut(ClientTaskListItemOut):
    allowed_transitions: list[TransitionOptionOut] = Field(default_factory=list)
    comments: list[ClientTaskCommentOut] = Field(default_factory=list)
    reviews: list[ClientTaskReviewOut] = Field(default_factory=list)


class ClientReviewQueueItemOut(BaseModel):
    task_id: UUID
    task_code: str
    task_name: str
    entity_id: UUID
    entity_name: str
    department_name: str
    status: str
    submitted_version_id: UUID | None = None
    submitted_version_label: str | None = None
    thumbnail_file_id: UUID | None = None
    submitted_at: datetime
    wait_hours: float
    can_act_as: str = "role:client"


# Entity links & Dependency templates (§4.2)
class EntityLinkCreateRequest(BaseModel):
    source_entity_id: UUID
    target_entity_id: UUID
    link_type: str | None = None
    note: str | None = None


class EntityLinkBulkCreateRequest(BaseModel):
    source_ids: list[UUID] = Field(default_factory=list)
    target_ids: list[UUID] = Field(default_factory=list)
    link_type: str | None = None
    note: str | None = None


class EntityLinkOut(BaseModel):
    id: UUID
    source_entity_id: UUID
    source_name: str
    source_type: str | None = None
    source_archived: bool = False
    target_entity_id: UUID
    target_name: str
    target_type: str | None = None
    target_archived: bool = False
    link_type: str | None = None
    note: str | None = None
    created_at: datetime


class IndirectEntityLinkOut(BaseModel):
    entity_id: UUID
    entity_name: str
    entity_type: str | None = None
    is_archived: bool = False
    depth: int
    via_entity_names: list[str] = Field(default_factory=list)


class EntityLinksResponse(BaseModel):
    entity_id: UUID
    uses: list[EntityLinkOut] = Field(default_factory=list)
    used_in: list[EntityLinkOut] = Field(default_factory=list)
    uses_indirect: list[IndirectEntityLinkOut] = Field(default_factory=list)
    used_in_indirect: list[IndirectEntityLinkOut] = Field(default_factory=list)
    link_types: list[str] = Field(default_factory=list)


class EntityGraphNodeOut(BaseModel):
    id: UUID
    name: str
    entity_type: str | None = None
    is_archived: bool = False


class EntityGraphEdgeOut(BaseModel):
    id: UUID
    source_entity_id: UUID
    target_entity_id: UUID
    link_type: str | None = None


class EntityLinksGraphOut(BaseModel):
    nodes: list[EntityGraphNodeOut] = Field(default_factory=list)
    edges: list[EntityGraphEdgeOut] = Field(default_factory=list)
    truncated: bool = False


class DependencyTemplateCreateRequest(BaseModel):
    upstream_department_id: UUID
    upstream_task_name: str | None = None
    downstream_department_id: UUID
    downstream_task_name: str | None = None
    threshold: Literal["APP", "PUBLISHED", "ANY_STATUS"] = "APP"
    enabled: bool = True


class DependencyTemplateUpdateRequest(BaseModel):
    upstream_department_id: UUID | None = None
    upstream_task_name: str | None = None
    downstream_department_id: UUID | None = None
    downstream_task_name: str | None = None
    threshold: Literal["APP", "PUBLISHED", "ANY_STATUS"] | None = None
    enabled: bool | None = None


class DependencyTemplateOut(BaseModel):
    id: UUID
    upstream_department_id: UUID
    upstream_department_name: str = ""
    upstream_task_name: str | None = None
    downstream_department_id: UUID
    downstream_department_name: str = ""
    downstream_task_name: str | None = None
    threshold: Literal["APP", "PUBLISHED", "ANY_STATUS"]
    enabled: bool


class SuggestDependenciesRequest(BaseModel):
    link_ids: list[UUID] | None = None
    depth: int | None = Field(default=None, ge=1, le=2)


class SuggestedDependencyOut(BaseModel):
    upstream_task_id: UUID
    upstream_task_code: str
    upstream_entity_name: str
    upstream_department: str
    downstream_task_id: UUID
    downstream_task_code: str
    downstream_entity_name: str
    downstream_department: str
    threshold: str
    already_exists: bool
    would_cycle: bool
    template_id: UUID


class ApplyDependencyPairIn(BaseModel):
    downstream_task_id: UUID
    upstream_task_id: UUID
    threshold: Literal["APP", "PUBLISHED", "ANY_STATUS"] = "APP"


class ApplyDependenciesRequest(BaseModel):
    pairs: list[ApplyDependencyPairIn] = Field(default_factory=list)


class SavedViewCreateRequest(BaseModel):
    view_kind: str
    name: str
    config_json: dict[str, Any] = Field(default_factory=dict)


class SavedViewOut(BaseModel):
    id: UUID
    view_kind: str
    name: str
    config_json: dict[str, Any]
    updated_at: datetime
