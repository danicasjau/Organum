import { useProjectStore } from '../../features/project/projectStore';
import type { components } from './schema';

export type HealthResponse = components['schemas']['HealthResponse'];
export type KnownProjectOut = components['schemas']['KnownProjectOut'];
export type ProjectCreateRequest = components['schemas']['ProjectCreateRequest'];
export type ProjectOpenRequest = components['schemas']['ProjectOpenRequest'];
export type FsBrowseResponse = components['schemas']['FsBrowseResponse'];
export type LauncherOut = components['schemas']['LauncherOut'];
export type LauncherItemIn = components['schemas']['LauncherItemIn'];
export type AutodetectedLauncherOut = components['schemas']['AutodetectedLauncherOut'];
export type UiPrefOut = components['schemas']['UiPrefOut'];
export type DepartmentOut = components['schemas']['DepartmentOut'];
export type DefaultTaskOut = components['schemas']['DefaultTaskOut'];
export type ReconcileReportOut = components['schemas']['ReconcileReportOut'];
export type EntityTreeOut = components['schemas']['EntityTreeOut'];
export type EntityOut = components['schemas']['EntityOut'];
export type EntityDepartmentOut = components['schemas']['EntityDepartmentOut'];
export type EntityCreateRequest = components['schemas']['EntityCreateRequest'];
export type EntityUpdateRequest = components['schemas']['EntityUpdateRequest'];
export type EntityDataItem = components['schemas']['EntityDataItem'];
export type FolderCreateRequest = components['schemas']['FolderCreateRequest'];
export type TaskOut = components['schemas']['TaskOut'];
export type ProductOut = components['schemas']['ProductOut'];
export type ProductVersionOut = components['schemas']['ProductVersionOut'];
export type PublishScenefilesRequest = components['schemas']['PublishScenefilesRequest'];
export type SceneEntryOut = components['schemas']['SceneEntryOut'];
export type SceneListResponse = components['schemas']['SceneListResponse'];
export type LaunchResponse = components['schemas']['LaunchResponse'];
export type FileSummaryOut = components['schemas']['FileSummaryOut'];
export type InspectionDocument = components['schemas']['InspectionDocument'];
export type ArtifactOut = components['schemas']['ArtifactOut'];
export type AnnotationOut = components['schemas']['AnnotationOut'];
export type AnnotationCreate = components['schemas']['AnnotationCreate'];
export type AnnotationUpdate = components['schemas']['AnnotationUpdate'];
export type ColorspaceListResponse = components['schemas']['ColorspaceListResponse'];
export type LutResponse = components['schemas']['LutResponse'];
export type BootstrapInfoOut = components['schemas']['BootstrapInfoOut'];
export type AuthMeOut = components['schemas']['AuthMeOut'];
export type UserOut = components['schemas']['UserOut'];
export type UserCreateRequest = components['schemas']['UserCreateRequest'];
export type UserUpdateRequest = components['schemas']['UserUpdateRequest'];
export type CompanyOut = components['schemas']['CompanyOut'];
export type CompanyCreateRequest = components['schemas']['CompanyCreateRequest'];
export type CompanyUpdateRequest = components['schemas']['CompanyUpdateRequest'];
export type RoleOut = components['schemas']['RoleOut'];
export type CapacityPermissionsOut = components['schemas']['CapacityPermissionsOut'];
export type ProjectSettingsOut = components['schemas']['ProjectSettingsOut'];
export type ProjectSettingsPatchRequest = components['schemas']['ProjectSettingsPatchRequest'];
export type AuditLogOut = components['schemas']['AuditLogOut'];
export type TaskAssignmentOut = components['schemas']['TaskAssignmentOut'];
export type TaskAssignmentItemIn = components['schemas']['TaskAssignmentItemIn'];
export type TaskListItemOut = components['schemas']['TaskListItemOut'];
export type TaskListOut = components['schemas']['TaskListOut'];
export type TaskDetailOut = components['schemas']['TaskDetailOut'];
export type TaskCreateFullRequest = components['schemas']['TaskCreateFullRequest'];
export type TaskPatchRequest = components['schemas']['TaskPatchRequest'];
export type TaskTransitionRequest = components['schemas']['TaskTransitionRequest'];
export type TransitionOptionOut = components['schemas']['TransitionOptionOut'];
export type TaskDependencyOut = components['schemas']['TaskDependencyOut'];
export type TaskDependencyIn = components['schemas']['TaskDependencyIn'];
export type TaskLinkOut = components['schemas']['TaskLinkOut'];
export type TaskLinkIn = components['schemas']['TaskLinkIn'];
export type TimeLogOut = components['schemas']['TimeLogOut'];
export type TimeLogCreateRequest = components['schemas']['TimeLogCreateRequest'];
export type TaskCommentOut = components['schemas']['TaskCommentOut'];
export type TaskCommentCreateRequest = components['schemas']['TaskCommentCreateRequest'];
export type TaskReviewOut = components['schemas']['TaskReviewOut'];
export type TaskEventOut = components['schemas']['TaskEventOut'];
export type TaskBulkRowIn = components['schemas']['TaskBulkRowIn'];
export type TaskBulkRequest = components['schemas']['TaskBulkRequest'];
export type TaskBulkResponse = components['schemas']['TaskBulkResponse'];
export type TaskSharesPutRequest = components['schemas']['TaskSharesPutRequest'];
export type ReviewQueueItemOut = components['schemas']['ReviewQueueItemOut'];
export type MyTasksResponse = components['schemas']['MyTasksResponse'];
export type ClientTaskListItemOut = components['schemas']['ClientTaskListItemOut'];
export type ClientTaskListOut = components['schemas']['ClientTaskListOut'];
export type ClientTaskDetailOut = components['schemas']['ClientTaskDetailOut'];
export type ClientReviewQueueItemOut = components['schemas']['ClientReviewQueueItemOut'];
export type ClientTaskCommentOut = components['schemas']['ClientTaskCommentOut'];
export type ClientTaskReviewOut = components['schemas']['ClientTaskReviewOut'];
export type ClientProductOut = components['schemas']['ClientProductOut'];
export type EntityLinkOut = components['schemas']['EntityLinkOut'];
export type TaskGraphNodeOut = components['schemas']['TaskGraphNodeOut'];
export type TaskGraphEdgeOut = components['schemas']['TaskGraphEdgeOut'];
export type TaskGraphOut = components['schemas']['TaskGraphOut'];
export type WorkloadCellSchema = components['schemas']['WorkloadCellSchema'];
export type WorkloadRowSchema = components['schemas']['WorkloadRowSchema'];
export type WorkloadResponse = components['schemas']['WorkloadResponse'];
export type EntityGraphNodeOut = components['schemas']['EntityGraphNodeOut'];
export type EntityGraphEdgeOut = components['schemas']['EntityGraphEdgeOut'];
export type IndirectEntityLinkOut = components['schemas']['IndirectEntityLinkOut'];
export type EntityLinksResponse = components['schemas']['EntityLinksResponse'];
export type EntityLinkCreateRequest = components['schemas']['EntityLinkCreateRequest'];
export type EntityLinkBulkCreateRequest = components['schemas']['EntityLinkBulkCreateRequest'];
export type EntityLinksGraphOut = components['schemas']['EntityLinksGraphOut'];
export type SuggestedDependencyOut = components['schemas']['SuggestedDependencyOut'];
export type ApplyDependenciesRequest = components['schemas']['ApplyDependenciesRequest'];
export type SavedViewOut = components['schemas']['SavedViewOut'];
export type ConfoGridOut = components['schemas']['ConfoGridOut'];
export type WorkHoursOut = components['schemas']['WorkHoursOut'];
export type MilestoneOut = components['schemas']['MilestoneOut'];
export type MilestoneIn = components['schemas']['MilestoneIn'];
export type DraftOut = components['schemas']['DraftOut'];
export type DraftChangeIn = components['schemas']['DraftChangeIn'];
export type DraftChangeOut = components['schemas']['DraftChangeOut'];
export type DraftPreviewOut = components['schemas']['DraftPreviewOut'];
export type ScheduleVersionOut = components['schemas']['ScheduleVersionOut'];
export type ScheduleCompareOut = components['schemas']['ScheduleCompareOut'];
export type WorkHoursPut = components['schemas']['WorkHoursPut'];
export type WorkDay = components['schemas']['WorkDay'];
export type WorkException = components['schemas']['WorkException'];
export type ActivationPeriodOut = components['schemas']['ActivationPeriodOut'];
export type ActivationPeriodIn = components['schemas']['ActivationPeriodIn'];
export type ActivationPeriodUpdate = components['schemas']['ActivationPeriodUpdate'];
export type CompanyCommentOut = components['schemas']['CompanyCommentOut'];
export type CompanyMembersOut = components['schemas']['CompanyMembersOut'];
export type ScheduleWarningOut = components['schemas']['ScheduleWarningOut'];
export type ConfoColumnOut = components['schemas']['ConfoColumnOut'];
export type ConfoColumnCreate = components['schemas']['ConfoColumnCreate'];
export type ConfoColumnUpdate = components['schemas']['ConfoColumnUpdate'];
export type ConfoRowOut = components['schemas']['ConfoRowOut'];
export type ConfoCellChangeIn = components['schemas']['ConfoCellChangeIn'];
export type ConfoCellsResult = components['schemas']['ConfoCellsResult'];
export type ConfoImportRequest = components['schemas']['ConfoImportRequest'];
export type ConfoImportPreviewOut = components['schemas']['ConfoImportPreviewOut'];
export type ConfoImportCommitOut = components['schemas']['ConfoImportCommitOut'];
export type ConfoImportMappingIn = components['schemas']['ConfoImportMappingIn'];
export type SavedViewCreateRequest = components['schemas']['SavedViewCreateRequest'];
export type RuleOut = components['schemas']['RuleOut'];
export type RuleCreateRequest = components['schemas']['RuleCreateRequest'];
export type RuleUpdateRequest = components['schemas']['RuleUpdateRequest'];
export type RulePreviewRequest = components['schemas']['RulePreviewRequest'];
export type RuleChangePreviewOut = components['schemas']['RuleChangePreviewOut'];
export type RulePreviewOut = components['schemas']['RulePreviewOut'];
export type RuleApplyRequest = components['schemas']['RuleApplyRequest'];
export type RuleApplyOut = components['schemas']['RuleApplyOut'];
export type DbColumnOut = components['schemas']['DbColumnOut'];
export type DbTableSummaryOut = components['schemas']['DbTableSummaryOut'];
export type DbTableRowsOut = components['schemas']['DbTableRowsOut'];
export type DbQueryRequest = components['schemas']['DbQueryRequest'];
export type DbQueryResultOut = components['schemas']['DbQueryResultOut'];
export type DependencyTemplateOut = components['schemas']['DependencyTemplateOut'];
export type DependencyTemplateCreateRequest = components['schemas']['DependencyTemplateCreateRequest'];
export type DependencyTemplateUpdateRequest = components['schemas']['DependencyTemplateUpdateRequest'];
export type DefaultTaskCreate = components['schemas']['DefaultTaskCreate'];
export type DefaultTaskUpdate = components['schemas']['DefaultTaskUpdate'];

export interface TaskListQuery {
  status?: string;
  priority?: string;
  department_id?: string;
  entity_id?: string;
  entity_path_prefix?: string;
  tag?: string;
  company_id?: string;
  user_id?: string;
  role_name?: string;
  my_capacity?: 'artist' | 'lead' | 'supervisor';
  mine_only?: boolean;
  include_linked_entities?: boolean;
  date_from?: string;
  date_to?: string;
  q?: string;
  sort?: 'code' | 'status' | 'priority' | 'due' | 'updated';
  cursor?: string;
  limit?: number;
}

export interface LayerThumbItem {
  id: string;
  label: string;
  kind: 'aov' | 'layer' | 'group' | 'tiff_page' | 'udim' | 'mosaic' | 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  auto_normalized?: boolean;
  channels?: number;
  dtype?: string;
  parent_id?: string | null;
  is_group?: boolean;
  visible?: boolean;
  blend_mode?: string;
  opacity?: number;
  page?: number;
  udim?: number | null;
  u?: number;
  v?: number;
  width_px?: number | null;
  height_px?: number | null;
}

export interface LayerThumbManifest {
  mode: 'exr_aovs' | 'psd_layers' | 'tiff_pages' | 'udim' | 'single';
  tile_size: number;
  atlas_width: number;
  atlas_height: number;
  atlas_path: string;
  page: number;
  page_size: number;
  total: number;
  items: LayerThumbItem[];
}

export interface UdimTileDescriptor {
  udim: number;
  u: number;
  v: number;
  filename: string;
  width?: number | null;
  height?: number | null;
  size: number;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    request_id?: string;
  };
}

function getProjBase(projectUuid?: string | null): string {
  const uuid = projectUuid ?? useProjectStore.getState().activeProjectUuid;
  if (!uuid) {
    throw new Error('No active project selected');
  }
  return `/api/v1/projects/${encodeURIComponent(uuid)}`;
}

const scenefilePreviewUrls = new Map<string, string>();

export function registerScenefilePreviewUrl(previewId: string, url: string): void {
  scenefilePreviewUrls.set(previewId, url);
}

export function isScenefilePreviewId(fileId: string | null | undefined): boolean {
  return Boolean(fileId && scenefilePreviewUrls.has(fileId));
}

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const pairs = document.cookie.split(';');
  for (const raw of pairs) {
    const idx = raw.indexOf('=');
    if (idx === -1) continue;
    const k = raw.slice(0, idx).trim();
    if (k === 'organum_csrf') {
      return decodeURIComponent(raw.slice(idx + 1).trim());
    }
  }
  return null;
}

let unauthorizedHandler: ((code?: string) => void) | null = null;
let passwordChangeRequiredHandler: (() => void) | null = null;
let authEpoch = 0;

export function bumpAuthEpoch(): void {
  authEpoch += 1;
}

export function registerAuthHandlers(handlers: {
  onUnauthorized?: (code?: string) => void;
  onPasswordChangeRequired?: () => void;
}): void {
  unauthorizedHandler = handlers.onUnauthorized ?? null;
  passwordChangeRequiredHandler = handlers.onPasswordChangeRequired ?? null;
}

export class ApiHttpError extends Error {
  status: number;
  code: string;
  /** Structured error details (e.g. per-cell validation issues on 422). */
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const reqEpoch = authEpoch;
  const method = (init?.method ?? 'GET').toUpperCase();
  const isMutating = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
  const csrfToken = isMutating ? readCsrfCookie() : null;
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    let code = 'http_error';
    let details: unknown;
    try {
      const body = (await response.json()) as ApiErrorEnvelope;
      if (body?.error?.message) message = body.error.message;
      if (body?.error?.code) code = body.error.code;
      details = body?.error?.details;
    } catch {
      // ignore non-JSON body
    }
    if (
      response.status === 401 &&
      reqEpoch === authEpoch &&
      !path.includes('/auth/login') &&
      !path.includes('/auth/me') &&
      !path.includes('/auth/logout')
    ) {
      unauthorizedHandler?.(code);
    }
    if (response.status === 403 && code === 'password_change_required') {
      passwordChangeRequiredHandler?.();
    }
    throw new ApiHttpError(response.status, code, message, details);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const apiClient = {
  getHealth: () => apiFetch<HealthResponse>('/api/v1/health'),

  // Auth & security
  getBootstrapInfo: () => apiFetch<BootstrapInfoOut>('/api/v1/auth/bootstrap'),
  getAuthMe: () => apiFetch<AuthMeOut>('/api/v1/auth/me'),
  login: (projectUuid: string, username: string, password: string) =>
    apiFetch<AuthMeOut>(`/api/v1/projects/${encodeURIComponent(projectUuid)}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ project_uuid: projectUuid, username, password }),
    }),
  logout: (projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/auth/logout`, { method: 'POST' }),
  changePassword: (
    payload: { current_password?: string | null; new_password: string },
    projectUuid?: string | null,
  ) =>
    apiFetch<AuthMeOut>(`${getProjBase(projectUuid)}/auth/change-password`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Users & Companies
  listUsers: (projectUuid?: string | null) =>
    apiFetch<UserOut[]>(`${getProjBase(projectUuid)}/users`),
  createUser: (payload: UserCreateRequest, projectUuid?: string | null) =>
    apiFetch<UserOut>(`${getProjBase(projectUuid)}/users`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateUser: (userId: string, payload: UserUpdateRequest, projectUuid?: string | null) =>
    apiFetch<UserOut>(`${getProjBase(projectUuid)}/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  resetUserPassword: (
    userId: string,
    payload: { new_password: string; must_change_password?: boolean },
    projectUuid?: string | null,
  ) =>
    apiFetch<UserOut>(`${getProjBase(projectUuid)}/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  setUserDepartments: (userId: string, departmentIds: string[], projectUuid?: string | null) =>
    apiFetch<UserOut>(`${getProjBase(projectUuid)}/users/${userId}/departments`, {
      method: 'PUT',
      body: JSON.stringify({ department_ids: departmentIds }),
    }),
  uploadUserAvatar: (userId: string, file: File, projectUuid?: string | null) => {
    const fd = new FormData();
    fd.append('file', file);
    return apiFetch<UserOut>(`${getProjBase(projectUuid)}/users/${userId}/avatar`, {
      method: 'POST',
      body: fd,
    });
  },
  userAvatarUrl: (userId: string, projectUuid?: string | null) =>
    `${getProjBase(projectUuid)}/users/${userId}/avatar`,

  listCompanies: (projectUuid?: string | null) =>
    apiFetch<CompanyOut[]>(`${getProjBase(projectUuid)}/companies`),
  createCompany: (payload: CompanyCreateRequest, projectUuid?: string | null) =>
    apiFetch<CompanyOut>(`${getProjBase(projectUuid)}/companies`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCompany: (
    companyId: string,
    payload: CompanyUpdateRequest,
    projectUuid?: string | null,
  ) =>
    apiFetch<CompanyOut>(`${getProjBase(projectUuid)}/companies/${companyId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteCompany: (companyId: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/companies/${companyId}`, {
      method: 'DELETE',
    }),
  setCompanyDepartments: (
    companyId: string,
    departmentIds: string[],
    projectUuid?: string | null,
  ) =>
    apiFetch<CompanyOut>(`${getProjBase(projectUuid)}/companies/${companyId}/departments`, {
      method: 'PUT',
      body: JSON.stringify({ department_ids: departmentIds }),
    }),

  // Roles, Capacities, Project Settings, Audit, Task Assignments & Client Shares
  listRoles: (projectUuid?: string | null) =>
    apiFetch<RoleOut[]>(`${getProjBase(projectUuid)}/roles`),
  createRole: (
    payload: { name: string; label: string; rank?: number },
    projectUuid?: string | null,
  ) =>
    apiFetch<RoleOut>(`${getProjBase(projectUuid)}/roles`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateRole: (
    roleId: string,
    payload: { label?: string; rank?: number },
    projectUuid?: string | null,
  ) =>
    apiFetch<RoleOut>(`${getProjBase(projectUuid)}/roles/${roleId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteRole: (roleId: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/roles/${roleId}`, {
      method: 'DELETE',
    }),
  putRolePermissions: (
    roleId: string,
    permissions: Record<string, 'all' | 'company' | 'mine' | 'shared' | 'none'>,
    projectUuid?: string | null,
  ) =>
    apiFetch<RoleOut>(`${getProjBase(projectUuid)}/roles/${roleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),
  getCapacities: (projectUuid?: string | null) =>
    apiFetch<CapacityPermissionsOut>(`${getProjBase(projectUuid)}/capacities`),
  putCapacities: (
    payload: { artist: string[]; lead: string[]; supervisor: string[] },
    projectUuid?: string | null,
  ) =>
    apiFetch<CapacityPermissionsOut>(`${getProjBase(projectUuid)}/capacities`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getProjectSettings: (projectUuid?: string | null) =>
    apiFetch<ProjectSettingsOut>(`${getProjBase(projectUuid)}/project/settings`),
  patchProjectSettings: (
    payload: ProjectSettingsPatchRequest,
    projectUuid?: string | null,
  ) =>
    apiFetch<ProjectSettingsOut>(`${getProjBase(projectUuid)}/project/settings`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  listAuditLogs: (action?: string, limit = 100, projectUuid?: string | null) => {
    const qs = new URLSearchParams();
    if (action) qs.set('action', action);
    qs.set('limit', String(limit));
    return apiFetch<AuditLogOut[]>(`${getProjBase(projectUuid)}/admin/audit?${qs.toString()}`);
  },
  listRules: (projectUuid?: string | null) =>
    apiFetch<RuleOut[]>(`${getProjBase(projectUuid)}/rules`),
  createRule: (payload: RuleCreateRequest, projectUuid?: string | null) =>
    apiFetch<RuleOut>(`${getProjBase(projectUuid)}/rules`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateRule: (ruleId: string, payload: RuleUpdateRequest, projectUuid?: string | null) =>
    apiFetch<RuleOut>(`${getProjBase(projectUuid)}/rules/${ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteRule: (ruleId: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/rules/${ruleId}`, {
      method: 'DELETE',
    }),
  reorderRules: (ids: string[], projectUuid?: string | null) =>
    apiFetch<RuleOut[]>(`${getProjBase(projectUuid)}/rules/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    }),
  previewRule: (payload: RulePreviewRequest, projectUuid?: string | null) =>
    apiFetch<RulePreviewOut>(`${getProjBase(projectUuid)}/rules/preview`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  applyRules: (payload: RuleApplyRequest, projectUuid?: string | null) =>
    apiFetch<RuleApplyOut>(`${getProjBase(projectUuid)}/rules/apply`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listDbTables: (projectUuid?: string | null) =>
    apiFetch<DbTableSummaryOut[]>(`${getProjBase(projectUuid)}/admin/db/tables`),
  browseDbTable: (
    tableName: string,
    opts?: {
      page?: number;
      pageSize?: number;
      sort?: string;
      sortDir?: 'asc' | 'desc';
      filter?: string;
    },
    projectUuid?: string | null,
  ) => {
    const qs = new URLSearchParams();
    if (opts?.page) qs.set('page', String(opts.page));
    if (opts?.pageSize) qs.set('page_size', String(opts.pageSize));
    if (opts?.sort) qs.set('sort', opts.sort);
    if (opts?.sortDir) qs.set('sort_dir', opts.sortDir);
    if (opts?.filter) qs.set('filter', opts.filter);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<DbTableRowsOut>(
      `${getProjBase(projectUuid)}/admin/db/tables/${encodeURIComponent(tableName)}${suffix}`,
    );
  },
  runDbQuery: (sql: string, projectUuid?: string | null) =>
    apiFetch<DbQueryResultOut>(`${getProjBase(projectUuid)}/admin/db/query`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    }),
  listDependencyTemplates: (projectUuid?: string | null) =>
    apiFetch<DependencyTemplateOut[]>(`${getProjBase(projectUuid)}/dependency-templates`),
  createDependencyTemplate: (
    payload: DependencyTemplateCreateRequest,
    projectUuid?: string | null,
  ) =>
    apiFetch<DependencyTemplateOut>(`${getProjBase(projectUuid)}/dependency-templates`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateDependencyTemplate: (
    templateId: string,
    payload: DependencyTemplateUpdateRequest,
    projectUuid?: string | null,
  ) =>
    apiFetch<DependencyTemplateOut>(
      `${getProjBase(projectUuid)}/dependency-templates/${templateId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
    ),
  deleteDependencyTemplate: (templateId: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/dependency-templates/${templateId}`, {
      method: 'DELETE',
    }),
  putTaskAssignments: (
    taskId: string,
    assignments: TaskAssignmentItemIn[],
    projectUuid?: string | null,
  ) =>
    apiFetch<TaskAssignmentOut[]>(`${getProjBase(projectUuid)}/tasks/${taskId}/assignments`, {
      method: 'PUT',
      body: JSON.stringify({ assignments }),
    }),
  putTaskShares: (
    taskId: string,
    payload: string[] | TaskSharesPutRequest,
    projectUuid?: string | null,
  ) =>
    apiFetch<string[]>(`${getProjBase(projectUuid)}/tasks/${taskId}/shares`, {
      method: 'PUT',
      body: JSON.stringify(
        Array.isArray(payload) ? { company_ids: payload } : payload,
      ),
    }),
  putVersionShares: (versionId: string, companyIds: string[], projectUuid?: string | null) =>
    apiFetch<string[]>(`${getProjBase(projectUuid)}/versions/${versionId}/shares`, {
      method: 'PUT',
      body: JSON.stringify({ company_ids: companyIds }),
    }),

  // Phase 7B/7C Tasks, Workflow, Comments, Reviews, TimeLogs, Bulk, MyTasks & Entity Links
  listTasks: (query: TaskListQuery = {}, projectUuid?: string | null) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '' || v === false) continue;
      qs.set(k, String(v));
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<TaskListOut | ClientTaskListOut>(`${getProjBase(projectUuid)}/tasks${suffix}`);
  },
  createFullTask: (payload: TaskCreateFullRequest, projectUuid?: string | null) =>
    apiFetch<TaskDetailOut>(`${getProjBase(projectUuid)}/tasks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getTask: (taskId: string, projectUuid?: string | null) =>
    apiFetch<TaskDetailOut | ClientTaskDetailOut>(`${getProjBase(projectUuid)}/tasks/${taskId}`),
  patchTask: (taskId: string, payload: TaskPatchRequest, projectUuid?: string | null) =>
    apiFetch<TaskDetailOut>(`${getProjBase(projectUuid)}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  transitionTask: (
    taskId: string,
    payload: TaskTransitionRequest,
    projectUuid?: string | null,
  ) =>
    apiFetch<TaskDetailOut | ClientTaskDetailOut>(
      `${getProjBase(projectUuid)}/tasks/${taskId}/transition`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),
  putTaskDependencies: (
    taskId: string,
    dependencies: TaskDependencyIn[],
    projectUuid?: string | null,
  ) =>
    apiFetch<TaskDependencyOut[]>(`${getProjBase(projectUuid)}/tasks/${taskId}/dependencies`, {
      method: 'PUT',
      body: JSON.stringify({ dependencies }),
    }),
  putTaskLinks: (taskId: string, links: TaskLinkIn[], projectUuid?: string | null) =>
    apiFetch<TaskLinkOut[]>(`${getProjBase(projectUuid)}/tasks/${taskId}/links`, {
      method: 'PUT',
      body: JSON.stringify({ links }),
    }),
  putTaskTags: (taskId: string, tags: string[], projectUuid?: string | null) =>
    apiFetch<string[]>(`${getProjBase(projectUuid)}/tasks/${taskId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags }),
    }),
  listTaskComments: (taskId: string, projectUuid?: string | null) =>
    apiFetch<Array<TaskCommentOut | ClientTaskCommentOut>>(
      `${getProjBase(projectUuid)}/tasks/${taskId}/comments`,
    ),
  createTaskComment: (
    taskId: string,
    payload: TaskCommentCreateRequest,
    projectUuid?: string | null,
  ) =>
    apiFetch<TaskCommentOut | ClientTaskCommentOut>(
      `${getProjBase(projectUuid)}/tasks/${taskId}/comments`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),
  listTaskEvents: (taskId: string, projectUuid?: string | null) =>
    apiFetch<TaskEventOut[]>(`${getProjBase(projectUuid)}/tasks/${taskId}/events`),
  listTimeLogs: (taskId: string, projectUuid?: string | null) =>
    apiFetch<TimeLogOut[]>(`${getProjBase(projectUuid)}/tasks/${taskId}/time-logs`),
  createTimeLog: (
    taskId: string,
    payload: TimeLogCreateRequest,
    projectUuid?: string | null,
  ) =>
    apiFetch<TimeLogOut>(`${getProjBase(projectUuid)}/tasks/${taskId}/time-logs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteTimeLog: (taskId: string, logId: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/tasks/${taskId}/time-logs/${logId}`, {
      method: 'DELETE',
    }),
  bulkTasks: (payload: TaskBulkRequest, projectUuid?: string | null) =>
    apiFetch<TaskBulkResponse>(`${getProjBase(projectUuid)}/tasks/bulk`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listReviewQueue: (projectUuid?: string | null) =>
    apiFetch<Array<ReviewQueueItemOut | ClientReviewQueueItemOut>>(
      `${getProjBase(projectUuid)}/review-queue`,
    ),
  getMyTasks: (projectUuid?: string | null) =>
    apiFetch<MyTasksResponse>(`${getProjBase(projectUuid)}/my/tasks`),
  listSavedViews: (viewKind?: string, projectUuid?: string | null) => {
    const suffix = viewKind ? `?view_kind=${encodeURIComponent(viewKind)}` : '';
    return apiFetch<SavedViewOut[]>(`${getProjBase(projectUuid)}/saved-views${suffix}`);
  },
  createSavedView: (payload: SavedViewCreateRequest, projectUuid?: string | null) =>
    apiFetch<SavedViewOut>(`${getProjBase(projectUuid)}/saved-views`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteSavedView: (viewId: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/saved-views/${viewId}`, {
      method: 'DELETE',
    }),
  // CR04 §5/§7 schedule drafts, versions, milestones
  listMilestones: (projectUuid?: string | null) =>
    apiFetch<MilestoneOut[]>(`${getProjBase(projectUuid)}/milestones`),
  getScheduleDraft: (projectUuid?: string | null) =>
    apiFetch<DraftOut>(`${getProjBase(projectUuid)}/schedule/draft`),
  addScheduleDraftChanges: (changes: DraftChangeIn[], projectUuid?: string | null) =>
    apiFetch<DraftOut>(`${getProjBase(projectUuid)}/schedule/draft/changes`, {
      method: 'POST',
      body: JSON.stringify({ changes }),
    }),
  revertScheduleDraftChange: (changeId: string, projectUuid?: string | null) =>
    apiFetch<DraftOut>(`${getProjBase(projectUuid)}/schedule/draft/changes/${changeId}`, {
      method: 'DELETE',
    }),
  discardScheduleDraft: (projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/schedule/draft`, { method: 'DELETE' }),
  previewScheduleDraft: (projectUuid?: string | null) =>
    apiFetch<DraftPreviewOut>(`${getProjBase(projectUuid)}/schedule/draft/preview`),
  saveScheduleDraft: (
    payload: { comment: string; overwrite_conflicts?: boolean },
    projectUuid?: string | null,
  ) =>
    apiFetch<ScheduleVersionOut>(`${getProjBase(projectUuid)}/schedule/draft/save`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listScheduleVersions: (projectUuid?: string | null) =>
    apiFetch<ScheduleVersionOut[]>(`${getProjBase(projectUuid)}/schedule/versions`),
  starScheduleVersion: (id: string, starred: boolean, projectUuid?: string | null) =>
    apiFetch<ScheduleVersionOut>(`${getProjBase(projectUuid)}/schedule/versions/${id}/star`, {
      method: 'POST',
      body: JSON.stringify({ starred }),
    }),
  jumpToScheduleVersion: (id: string, projectUuid?: string | null) =>
    apiFetch<DraftOut>(`${getProjBase(projectUuid)}/schedule/versions/${id}/jump`, {
      method: 'POST',
    }),
  compareScheduleVersions: (a: string, b: string, projectUuid?: string | null) =>
    apiFetch<ScheduleCompareOut>(
      `${getProjBase(projectUuid)}/schedule/versions/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
    ),
  // CR04 §6/§8/§11 people & time
  getWorkHours: (userId: string, projectUuid?: string | null) =>
    apiFetch<WorkHoursOut>(`${getProjBase(projectUuid)}/users/${userId}/work-hours`),
  putWorkHours: (userId: string, payload: WorkHoursPut, projectUuid?: string | null) =>
    apiFetch<WorkHoursOut>(`${getProjBase(projectUuid)}/users/${userId}/work-hours`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  listActivationPeriods: (
    query: { target_kind?: string; target_id?: string } = {},
    projectUuid?: string | null,
  ) => {
    const qs = new URLSearchParams();
    if (query.target_kind) qs.set('target_kind', query.target_kind);
    if (query.target_id) qs.set('target_id', query.target_id);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<ActivationPeriodOut[]>(`${getProjBase(projectUuid)}/activation-periods${suffix}`);
  },
  createActivationPeriod: (payload: ActivationPeriodIn, projectUuid?: string | null) =>
    apiFetch<ActivationPeriodOut>(`${getProjBase(projectUuid)}/activation-periods`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateActivationPeriod: (
    id: string,
    patch: ActivationPeriodUpdate,
    projectUuid?: string | null,
  ) =>
    apiFetch<ActivationPeriodOut>(`${getProjBase(projectUuid)}/activation-periods/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteActivationPeriod: (id: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/activation-periods/${id}`, { method: 'DELETE' }),
  listScheduleWarnings: (taskId?: string | null, projectUuid?: string | null) =>
    apiFetch<ScheduleWarningOut[]>(
      `${getProjBase(projectUuid)}/schedule/warnings${taskId ? `?task_id=${taskId}` : ''}`,
    ),
  listCompanyComments: (companyId: string, projectUuid?: string | null) =>
    apiFetch<CompanyCommentOut[]>(`${getProjBase(projectUuid)}/companies/${companyId}/comments`),
  addCompanyComment: (companyId: string, body: string, projectUuid?: string | null) =>
    apiFetch<CompanyCommentOut>(`${getProjBase(projectUuid)}/companies/${companyId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  deleteCompanyComment: (companyId: string, commentId: string, projectUuid?: string | null) =>
    apiFetch<void>(
      `${getProjBase(projectUuid)}/companies/${companyId}/comments/${commentId}`,
      { method: 'DELETE' },
    ),
  getCompanyMembers: (companyId: string, projectUuid?: string | null) =>
    apiFetch<CompanyMembersOut>(`${getProjBase(projectUuid)}/companies/${companyId}/members`),
  putCompanyMembers: (companyId: string, userIds: string[], projectUuid?: string | null) =>
    apiFetch<CompanyMembersOut>(`${getProjBase(projectUuid)}/companies/${companyId}/members`, {
      method: 'PUT',
      body: JSON.stringify({ user_ids: userIds }),
    }),
  // CR04 §3 Confo
  getConfo: (projectUuid?: string | null) =>
    apiFetch<ConfoGridOut>(`${getProjBase(projectUuid)}/confo`),
  patchConfoCells: (changes: ConfoCellChangeIn[], projectUuid?: string | null) =>
    apiFetch<ConfoCellsResult>(`${getProjBase(projectUuid)}/confo/cells`, {
      method: 'PATCH',
      body: JSON.stringify({ changes }),
    }),
  createConfoColumn: (payload: ConfoColumnCreate, projectUuid?: string | null) =>
    apiFetch<ConfoColumnOut>(`${getProjBase(projectUuid)}/confo/columns`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateConfoColumn: (id: string, patch: ConfoColumnUpdate, projectUuid?: string | null) =>
    apiFetch<ConfoColumnOut>(`${getProjBase(projectUuid)}/confo/columns/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  reorderConfoColumns: (ids: string[], projectUuid?: string | null) =>
    apiFetch<ConfoColumnOut[]>(`${getProjBase(projectUuid)}/confo/columns/order`, {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    }),
  deleteConfoColumn: (id: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/confo/columns/${id}`, { method: 'DELETE' }),
  listConfoTrash: (projectUuid?: string | null) =>
    apiFetch<ConfoColumnOut[]>(`${getProjBase(projectUuid)}/confo/columns/trash`),
  restoreConfoColumn: (id: string, projectUuid?: string | null) =>
    apiFetch<ConfoColumnOut>(`${getProjBase(projectUuid)}/confo/columns/${id}/restore`, {
      method: 'POST',
    }),
  purgeConfoColumn: (id: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/confo/columns/${id}/purge`, {
      method: 'DELETE',
    }),
  previewConfoImport: (payload: ConfoImportRequest, projectUuid?: string | null) =>
    apiFetch<ConfoImportPreviewOut>(`${getProjBase(projectUuid)}/confo/import/preview`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  commitConfoImport: (payload: ConfoImportRequest, projectUuid?: string | null) =>
    apiFetch<ConfoImportCommitOut>(`${getProjBase(projectUuid)}/confo/import/commit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getEntityLinks: (entityId: string, depth = 3, projectUuid?: string | null) =>
    apiFetch<EntityLinksResponse>(
      `${getProjBase(projectUuid)}/entities/${entityId}/links?depth=${depth}`,
    ),
  createEntityLink: (payload: EntityLinkCreateRequest, projectUuid?: string | null) =>
    apiFetch<EntityLinkOut>(`${getProjBase(projectUuid)}/entity-links`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  bulkCreateEntityLinks: (payload: EntityLinkBulkCreateRequest, projectUuid?: string | null) =>
    apiFetch<EntityLinkOut[]>(`${getProjBase(projectUuid)}/entity-links/bulk`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteEntityLink: (linkId: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/entity-links/${linkId}`, {
      method: 'DELETE',
    }),
  getEntityLinksGraph: (
    queryOrProjectUuid?:
      | string
      | null
      | { entity_id?: string; hops?: number; limit?: number },
    maybeProjectUuid?: string | null,
  ) => {
    const isQueryObj =
      queryOrProjectUuid !== null &&
      typeof queryOrProjectUuid === 'object';
    const query = isQueryObj ? queryOrProjectUuid : undefined;
    const projectUuid = isQueryObj ? maybeProjectUuid : queryOrProjectUuid;
    const params = new URLSearchParams();
    if (query?.entity_id) params.set('entity_id', query.entity_id);
    if (query?.hops !== undefined) params.set('hops', String(query.hops));
    if (query?.limit !== undefined) params.set('limit', String(query.limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<EntityLinksGraphOut>(
      `${getProjBase(projectUuid)}/entity-links/graph${qs}`,
    );
  },

  getTaskGraph: (
    query?: {
      task_id?: string;
      entity_id?: string;
      department_id?: string;
      hops?: number;
      limit?: number;
    },
    projectUuid?: string | null,
  ) => {
    const params = new URLSearchParams();
    if (query?.task_id) params.set('task_id', query.task_id);
    if (query?.entity_id) params.set('entity_id', query.entity_id);
    if (query?.department_id) params.set('department_id', query.department_id);
    if (query?.hops !== undefined) params.set('hops', String(query.hops));
    if (query?.limit !== undefined) params.set('limit', String(query.limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<TaskGraphOut>(`${getProjBase(projectUuid)}/tasks/graph${qs}`);
  },

  getWorkload: (
    query?: {
      date_from?: string;
      date_to?: string;
      department_id?: string;
      company_id?: string;
    },
    projectUuid?: string | null,
  ) => {
    const params = new URLSearchParams();
    if (query?.date_from) params.set('date_from', query.date_from);
    if (query?.date_to) params.set('date_to', query.date_to);
    if (query?.department_id) params.set('department_id', query.department_id);
    if (query?.company_id) params.set('company_id', query.company_id);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<WorkloadResponse>(`${getProjBase(projectUuid)}/workload${qs}`);
  },
  suggestEntityDependencies: (
    entityId: string,
    payload: { link_ids?: string[] | null; depth?: number | null } = {},
    projectUuid?: string | null,
  ) =>
    apiFetch<SuggestedDependencyOut[]>(
      `${getProjBase(projectUuid)}/entities/${entityId}/suggest-dependencies`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),
  applyEntityDependencies: (
    entityId: string,
    payload: ApplyDependenciesRequest,
    projectUuid?: string | null,
  ) =>
    apiFetch<{ applied: number }>(
      `${getProjBase(projectUuid)}/entities/${entityId}/apply-dependencies`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  // App-level project registry & preferences
  listProjects: () => apiFetch<KnownProjectOut[]>('/api/v1/projects'),
  createProject: (payload: ProjectCreateRequest) =>
    apiFetch<KnownProjectOut>('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  openProject: (path: string) =>
    apiFetch<KnownProjectOut>('/api/v1/projects/open', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  forgetProject: (projectUuid: string) =>
    apiFetch<void>(`/api/v1/projects/${encodeURIComponent(projectUuid)}`, {
      method: 'DELETE',
    }),
  browseFs: (path = '') =>
    apiFetch<FsBrowseResponse>(`/api/v1/fs/browse?path=${encodeURIComponent(path)}`),
  listLaunchers: () => apiFetch<LauncherOut[]>('/api/v1/launchers'),
  saveLaunchers: (launchers: LauncherItemIn[]) =>
    apiFetch<LauncherOut[]>('/api/v1/launchers', {
      method: 'PUT',
      body: JSON.stringify({ launchers }),
    }),
  autodetectLaunchers: () =>
    apiFetch<AutodetectedLauncherOut[]>('/api/v1/launchers/autodetect', { method: 'POST' }),
  listUiPrefs: () => apiFetch<UiPrefOut[]>('/api/v1/ui-prefs'),
  putUiPref: (key: string, valueJson: unknown) =>
    apiFetch<UiPrefOut>(`/api/v1/ui-prefs/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value_json: valueJson }),
    }),

  // Project-scoped departments catalog
  listDepartments: (projectUuid?: string | null) =>
    apiFetch<DepartmentOut[]>(`${getProjBase(projectUuid)}/departments`),
  createDepartment: (name: string, projectUuid?: string | null, shortCode?: string) =>
    apiFetch<DepartmentOut>(`${getProjBase(projectUuid)}/departments`, {
      method: 'POST',
      body: JSON.stringify({ name, short_code: shortCode?.trim() || undefined }),
    }),
  updateDepartment: (
    deptId: string,
    patch: {
      name?: string;
      short_code?: string;
      color?: string;
      is_active?: boolean;
      sort_order?: number;
    },
    projectUuid?: string | null,
  ) =>
    apiFetch<DepartmentOut>(`${getProjBase(projectUuid)}/departments/${deptId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteDepartment: (deptId: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/departments/${deptId}`, {
      method: 'DELETE',
    }),
  reorderDepartments: (ids: string[], projectUuid?: string | null) =>
    apiFetch<DepartmentOut[]>(`${getProjBase(projectUuid)}/departments/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    }),
  createDefaultTask: (
    deptId: string,
    nameOrPayload: string | DefaultTaskCreate,
    projectUuid?: string | null,
  ) =>
    apiFetch<DefaultTaskOut>(
      `${getProjBase(projectUuid)}/departments/${deptId}/default-tasks`,
      {
        method: 'POST',
        body: JSON.stringify(
          typeof nameOrPayload === 'string' ? { name: nameOrPayload } : nameOrPayload,
        ),
      },
    ),
  updateDefaultTask: (
    taskId: string,
    patch: DefaultTaskUpdate,
    projectUuid?: string | null,
  ) =>
    apiFetch<DefaultTaskOut>(
      `${getProjBase(projectUuid)}/departments/default-tasks/${taskId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
    ),
  deleteDefaultTask: (taskId: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/departments/default-tasks/${taskId}`, {
      method: 'DELETE',
    }),
  reorderDefaultTasks: (deptId: string, ids: string[], projectUuid?: string | null) =>
    apiFetch<DefaultTaskOut[]>(
      `${getProjBase(projectUuid)}/departments/${deptId}/default-tasks/reorder`,
      {
        method: 'PUT',
        body: JSON.stringify({ ids }),
      },
    ),

  // Project-scoped entities, folders, tasks, products, scenefiles, launch & viewer APIs
  listEntities: (
    projectUuid?: string | null,
    params?: {
      q?: string;
      tags?: string[];
      type?: string;
      department?: string;
      folder?: string;
      sort?: string;
    },
  ) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.type) qs.set('type', params.type);
    if (params?.department) qs.set('department', params.department);
    if (params?.folder !== undefined) qs.set('folder', params.folder);
    if (params?.sort) qs.set('sort', params.sort);
    for (const t of params?.tags ?? []) {
      qs.append('tag', t);
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<EntityTreeOut>(`${getProjBase(projectUuid)}/entities${suffix}`);
  },
  createEntity: (payload: EntityCreateRequest, projectUuid?: string | null) =>
    apiFetch<EntityOut>(`${getProjBase(projectUuid)}/entities`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateEntity: (entityId: string, payload: EntityUpdateRequest, projectUuid?: string | null) =>
    apiFetch<EntityOut>(`${getProjBase(projectUuid)}/entities/${entityId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteEntity: (entityId: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/entities/${entityId}`, {
      method: 'DELETE',
    }),
  createFolder: (payload: FolderCreateRequest, projectUuid?: string | null) =>
    apiFetch<{ rel_path: string }>(`${getProjBase(projectUuid)}/folders`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  promoteFolder: (relPath: string, projectUuid?: string | null) =>
    apiFetch<EntityOut>(`${getProjBase(projectUuid)}/folders/promote`, {
      method: 'POST',
      body: JSON.stringify({ rel_path: relPath }),
    }),
  putEntityTags: (entityId: string, tags: string[], projectUuid?: string | null) =>
    apiFetch<string[]>(`${getProjBase(projectUuid)}/entities/${entityId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags }),
    }),
  getEntityData: (entityId: string, projectUuid?: string | null) =>
    apiFetch<EntityDataItem[]>(`${getProjBase(projectUuid)}/entities/${entityId}/data`),
  putEntityData: (entityId: string, items: EntityDataItem[], projectUuid?: string | null) =>
    apiFetch<EntityDataItem[]>(`${getProjBase(projectUuid)}/entities/${entityId}/data`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
  putEntityThumbnail: (
    entityId: string,
    payload: { file_id?: string | null; source: 'auto' | 'manual' | 'none' },
    projectUuid?: string | null,
  ) =>
    apiFetch<EntityOut>(`${getProjBase(projectUuid)}/entities/${entityId}/thumbnail`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  entityThumbnailUrl: (entityId: string, projectUuid?: string | null) =>
    `${getProjBase(projectUuid)}/entities/${entityId}/thumbnail`,
  addEntityDepartment: (
    entityId: string,
    departmentId: string,
    projectUuid?: string | null,
  ) =>
    apiFetch<EntityDepartmentOut>(`${getProjBase(projectUuid)}/entities/${entityId}/departments`, {
      method: 'POST',
      body: JSON.stringify({ department_id: departmentId }),
    }),
  removeEntityDepartment: (edId: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/entity-departments/${edId}`, {
      method: 'DELETE',
    }),
  createTask: (edId: string, name: string, projectUuid?: string | null) =>
    apiFetch<TaskOut>(`${getProjBase(projectUuid)}/entity-departments/${edId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  updateTask: (
    taskId: string,
    patch: { name?: string; sort_order?: number },
    projectUuid?: string | null,
  ) =>
    apiFetch<TaskOut>(`${getProjBase(projectUuid)}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteTask: (taskId: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/tasks/${taskId}`, {
      method: 'DELETE',
    }),

  getTaskProduct: (taskId: string, projectUuid?: string | null) =>
    apiFetch<ProductOut>(`${getProjBase(projectUuid)}/tasks/${taskId}/product`),
  publishScenefiles: (
    taskId: string,
    payload: PublishScenefilesRequest,
    projectUuid?: string | null,
  ) =>
    apiFetch<ProductVersionOut>(`${getProjBase(projectUuid)}/tasks/${taskId}/publish`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  publishUploads: (
    taskId: string,
    files: File[],
    comment: string,
    setMaster: boolean | null,
    projectUuid?: string | null,
  ) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    fd.append('comment', comment);
    if (setMaster !== null) fd.append('set_master', String(setMaster));
    return apiFetch<ProductVersionOut>(`${getProjBase(projectUuid)}/tasks/${taskId}/publish/upload`, {
      method: 'POST',
      body: fd,
    });
  },
  setProductMaster: (productId: string, versionId: string, projectUuid?: string | null) =>
    apiFetch<ProductOut>(`${getProjBase(projectUuid)}/products/${productId}/master`, {
      method: 'PUT',
      body: JSON.stringify({ version_id: versionId }),
    }),
  deleteVersion: (versionId: string, projectUuid?: string | null) =>
    apiFetch<void>(`${getProjBase(projectUuid)}/versions/${versionId}`, {
      method: 'DELETE',
    }),

  listScenefiles: (taskId: string, path = '', projectUuid?: string | null) =>
    apiFetch<SceneListResponse>(
      `${getProjBase(projectUuid)}/tasks/${taskId}/scenefiles?path=${encodeURIComponent(path)}`,
    ),
  scenefileThumbUrl: (taskId: string, path: string, projectUuid?: string | null) =>
    `${getProjBase(projectUuid)}/tasks/${taskId}/scenefiles/thumbnail?path=${encodeURIComponent(path)}`,
  scenefileContentUrl: (taskId: string, path: string, projectUuid?: string | null) =>
    `${getProjBase(projectUuid)}/tasks/${taskId}/scenefiles/content?path=${encodeURIComponent(path)}`,
  inspectScenefile: (taskId: string, path: string, projectUuid?: string | null) =>
    apiFetch<InspectionDocument>(
      `${getProjBase(projectUuid)}/tasks/${taskId}/scenefiles/inspect?path=${encodeURIComponent(path)}`,
    ),
  scenefileWatchUrl: (taskId: string, path = '', projectUuid?: string | null) =>
    `${getProjBase(projectUuid)}/tasks/${taskId}/scenefiles/watch?path=${encodeURIComponent(path)}`,
  mkdirScenefile: (taskId: string, path: string, name: string, projectUuid?: string | null) =>
    apiFetch<{ rel_path: string }>(`${getProjBase(projectUuid)}/tasks/${taskId}/scenefiles/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    }),
  uploadScenefiles: (
    taskId: string,
    path: string,
    files: File[],
    projectUuid?: string | null,
  ) => {
    const fd = new FormData();
    fd.append('path', path);
    for (const f of files) fd.append('files', f);
    return apiFetch<{ uploaded: string[] }>(
      `${getProjBase(projectUuid)}/tasks/${taskId}/scenefiles/upload`,
      {
        method: 'POST',
        body: fd,
      },
    );
  },
  renameScenefile: (
    taskId: string,
    relPath: string,
    newName: string,
    projectUuid?: string | null,
  ) =>
    apiFetch<{ rel_path: string }>(
      `${getProjBase(projectUuid)}/tasks/${taskId}/scenefiles/rename`,
      {
        method: 'POST',
        body: JSON.stringify({ rel_path: relPath, new_name: newName }),
      },
    ),
  moveScenefiles: (
    taskId: string,
    relPaths: string[],
    destDir: string,
    projectUuid?: string | null,
  ) =>
    apiFetch<{ moved: string[] }>(`${getProjBase(projectUuid)}/tasks/${taskId}/scenefiles/move`, {
      method: 'POST',
      body: JSON.stringify({ rel_paths: relPaths, dest_dir: destDir }),
    }),
  deleteScenefiles: (taskId: string, relPaths: string[], projectUuid?: string | null) =>
    apiFetch<{ trashed: number }>(`${getProjBase(projectUuid)}/tasks/${taskId}/scenefiles/delete`, {
      method: 'POST',
      body: JSON.stringify({ rel_paths: relPaths }),
    }),

  launchFile: (relPath: string, launcherId?: string | null, projectUuid?: string | null) =>
    apiFetch<LaunchResponse>(`${getProjBase(projectUuid)}/launch`, {
      method: 'POST',
      body: JSON.stringify({ rel_path: relPath, launcher_id: launcherId ?? null }),
    }),
  revealPath: (relPath: string, projectUuid?: string | null) =>
    apiFetch<LaunchResponse>(`${getProjBase(projectUuid)}/reveal`, {
      method: 'POST',
      body: JSON.stringify({ rel_path: relPath }),
    }),
  listCustomIcons: () => apiFetch<string[]>('/api/v1/icons'),
  customIconUrl: (ext: string) =>
    `/api/v1/icons/${encodeURIComponent(ext.replace(/^\./, '').toLowerCase())}`,

  reconcileProject: (projectUuid?: string | null) =>
    apiFetch<ReconcileReportOut>(`${getProjBase(projectUuid)}/reconcile`, { method: 'POST' }),

  inspectFile: (fileId: string, projectUuid?: string | null) =>
    apiFetch<InspectionDocument>(`${getProjBase(projectUuid)}/files/${fileId}/inspect`),
  patchFile: (
    fileId: string,
    patch:
      | string
      | null
      | {
        colorspace_override?: string | null;
        sequence_kind?: 'none' | 'frames' | 'udim' | 'auto';
        sequence_kind_user_override?: boolean;
      },
    projectUuid?: string | null,
  ) => {
    const body = typeof patch === 'object' && patch !== null ? patch : { colorspace_override: patch };
    return apiFetch<FileSummaryOut>(`${getProjBase(projectUuid)}/files/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  createArtifact: (
    fileId: string,
    kind: string,
    params: Record<string, unknown> = {},
    projectUuid?: string | null,
  ) =>
    apiFetch<ArtifactOut>(`${getProjBase(projectUuid)}/files/${fileId}/artifacts/${kind}`, {
      method: 'POST',
      body: JSON.stringify({ params }),
    }),
  listAnnotations: (fileId: string, projectUuid?: string | null) =>
    apiFetch<AnnotationOut[]>(`${getProjBase(projectUuid)}/files/${fileId}/annotations`),
  createAnnotation: (
    fileId: string,
    payload: Omit<AnnotationCreate, 'coord_space' | 'visibility'> & {
      coord_space?: string;
      visibility?: 'internal' | 'client';
    },
    projectUuid?: string | null,
  ) =>
    apiFetch<AnnotationOut>(`${getProjBase(projectUuid)}/files/${fileId}/annotations`, {
      method: 'POST',
      body: JSON.stringify({ coord_space: 'image', ...payload }),
    }),
  updateAnnotation: (
    fileId: string,
    annotationId: string,
    payload: AnnotationUpdate,
    projectUuid?: string | null,
  ) =>
    apiFetch<AnnotationOut>(
      `${getProjBase(projectUuid)}/files/${fileId}/annotations/${annotationId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
    ),
  deleteAnnotation: (fileId: string, annotationId: string, projectUuid?: string | null) =>
    apiFetch<void>(
      `${getProjBase(projectUuid)}/files/${fileId}/annotations/${annotationId}`,
      {
        method: 'DELETE',
      },
    ),

  fileContentUrl: (fileId: string, projectUuid?: string | null) =>
    scenefilePreviewUrls.get(fileId) ?? `${getProjBase(projectUuid)}/files/${fileId}/content`,
  fileThumbnailUrl: (fileId: string, projectUuid?: string | null) =>
    `${getProjBase(projectUuid)}/files/${fileId}/thumbnail`,
  sequenceFrameUrl: (fileId: string, frame: number, projectUuid?: string | null) =>
    `${getProjBase(projectUuid)}/files/${fileId}/sequence/${frame}`,
  udimTileContentUrl: (fileId: string, udim: number, projectUuid?: string | null) =>
    `${getProjBase(projectUuid)}/files/${fileId}/udim/${udim}/content`,
  artifactAtlasUrl: (artifactId: string, projectUuid?: string | null) =>
    `${getProjBase(projectUuid)}/artifacts/${artifactId}/atlas`,

  getColorspaces: () => apiFetch<ColorspaceListResponse>('/api/v1/colorspaces'),
  getColorspaceLut: (src: string, dst: string, size = 17) =>
    apiFetch<LutResponse>(
      `/api/v1/colorspaces/lut?src=${encodeURIComponent(src)}&dst=${encodeURIComponent(dst)}&size=${size}`,
    ),
};
