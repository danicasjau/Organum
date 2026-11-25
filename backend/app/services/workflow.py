from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from app.core.errors import AppError

TASK_STATUSES: tuple[str, ...] = (
    "WTG",
    "RDY",
    "IP",
    "RTK",
    "P_LEAD",
    "P_SUP",
    "P_CLIENT",
    "APP",
    "HLD",
)
REVIEW_STATUSES: tuple[str, ...] = ("P_LEAD", "P_SUP", "P_CLIENT")
PRIORITIES: tuple[str, ...] = ("normal", "high", "stopper")
DEPENDENCY_THRESHOLDS: tuple[str, ...] = ("APP", "PUBLISHED", "ANY_STATUS")


@dataclass(frozen=True, slots=True)
class TaskWorkflowState:
    status: str
    status_before_hold: str | None = None
    needs_lead_review: bool = True
    needs_sup_review: bool = False
    needs_client_review: bool = False
    has_version: bool = False
    actual_start_set: bool = False


@dataclass(frozen=True, slots=True)
class WorkflowPolicy:
    require_version_to_submit: bool = True


@dataclass(frozen=True, slots=True)
class WorkflowActor:
    role_name: str
    grants: dict[str, str]  # permission_key -> via_label ("role:...", "capacity:...")


@dataclass(frozen=True, slots=True)
class TransitionOption:
    to: str
    action: str
    acted_as: str
    on_behalf: bool = False
    requires_comment: bool = False
    requires_version: bool = False


@dataclass(frozen=True, slots=True)
class TransitionResult:
    from_status: str
    to_status: str
    action: str
    acted_as: str
    on_behalf_of_client: bool
    review_stage: str | None
    review_decision: str | None
    status_before_hold: str | None
    set_actual_start: bool
    set_actual_finish: bool
    clear_actual_finish: bool
    increment_retake: bool
    set_approved_version: bool
    auto_share_client: bool


def is_dependency_satisfied(
    upstream_status: str,
    upstream_has_version: bool,
    threshold: str,
) -> bool:
    """Return True when an upstream task satisfies the requested dependency threshold."""
    if threshold == "ANY_STATUS":
        return True
    if threshold == "PUBLISHED":
        return upstream_has_version or upstream_status == "APP"
    return upstream_status == "APP"


def first_review_stage(state: TaskWorkflowState) -> str:
    """Return the first enabled review stage after IP/RTK, or APP if none are enabled."""
    if state.needs_lead_review:
        return "P_LEAD"
    if state.needs_sup_review:
        return "P_SUP"
    if state.needs_client_review:
        return "P_CLIENT"
    return "APP"


def next_review_stage(current_stage: str, state: TaskWorkflowState) -> str:
    """Return the next enabled review stage after current_stage is approved, or APP."""
    if current_stage == "P_LEAD":
        if state.needs_sup_review:
            return "P_SUP"
        if state.needs_client_review:
            return "P_CLIENT"
        return "APP"
    if current_stage == "P_SUP":
        if state.needs_client_review:
            return "P_CLIENT"
        return "APP"
    if current_stage == "P_CLIENT":
        return "APP"
    return first_review_stage(state)


def _stage_perm_for_status(status: str) -> tuple[str, str]:
    if status == "P_LEAD":
        return "task.approve.lead", "lead"
    if status == "P_SUP":
        return "task.approve.sup", "sup"
    if status == "P_CLIENT":
        return "task.approve.client", "client"
    raise AppError("invalid_transition", f"Status '{status}' is not a review stage", 400)


def _structural_edges(state: TaskWorkflowState) -> list[tuple[str, str]]:
    """Return (target_status, action) structurally possible from state.status."""
    cur = state.status
    edges: list[tuple[str, str]] = []
    if cur == "WTG":
        edges.append(("RDY", "force_ready"))
    elif cur == "RDY":
        edges.append(("IP", "start"))
    elif cur == "IP":
        edges.append((first_review_stage(state), "submit"))
    elif cur == "RTK":
        edges.append(("IP", "start"))
        edges.append((first_review_stage(state), "submit"))
    elif cur in REVIEW_STATUSES:
        edges.append((next_review_stage(cur, state), "approve"))
        edges.append(("RTK", "retake"))
    elif cur == "APP":
        edges.append(("RTK", "reopen"))
    elif cur == "HLD":
        resume_target = (
            state.status_before_hold if state.status_before_hold in TASK_STATUSES else "RDY"
        )
        if resume_target == "HLD" or resume_target is None:
            resume_target = "RDY"
        edges.append((resume_target, "resume"))

    if cur != "HLD":
        edges.append(("HLD", "hold"))
    return edges


def _grant_for_edge(
    from_status: str,
    action: str,
    actor: WorkflowActor,
) -> tuple[str | None, bool]:
    """Return (acted_as, on_behalf) if actor is permitted for edge, else (None, False)."""
    if action == "force_ready":
        return actor.grants.get("task.status.force"), False
    if action == "start":
        return actor.grants.get("task.status.start"), False
    if action == "submit":
        return actor.grants.get("task.status.submit"), False
    if action in {"hold", "resume"}:
        return actor.grants.get("task.status.hold"), False
    if action in {"approve", "retake"}:
        perm_key, _ = _stage_perm_for_status(from_status)
        via = actor.grants.get(perm_key)
        if via is None:
            return None, False
        if from_status == "P_CLIENT" and actor.role_name in {"producer", "admin"}:
            return "on_behalf", True
        return via, False
    if action == "reopen":
        for key in (
            "task.status.reopen",
            "task.approve.sup",
            "task.approve.lead",
            "task.approve.client",
        ):
            via = actor.grants.get(key)
            if via is not None:
                return via, False
        return None, False
    return None, False


def evaluate_allowed_transitions(
    state: TaskWorkflowState,
    actor: WorkflowActor,
    policy: WorkflowPolicy,
) -> list[TransitionOption]:
    """Compute every next status currently allowed for actor on this task."""
    options: list[TransitionOption] = []
    seen: set[str] = set()
    for target_status, action in _structural_edges(state):
        if target_status in seen:
            continue
        acted_as, on_behalf = _grant_for_edge(state.status, action, actor)
        if acted_as is None:
            continue
        seen.add(target_status)
        options.append(
            TransitionOption(
                to=target_status,
                action=action,
                acted_as=acted_as,
                on_behalf=on_behalf,
                requires_comment=action in {"retake", "reopen"},
                requires_version=(action == "submit" and policy.require_version_to_submit),
            )
        )
    return options


def validate_transition(
    state: TaskWorkflowState,
    actor: WorkflowActor,
    policy: WorkflowPolicy,
    target_status: str,
    *,
    comment: str | None = None,
    version_id: UUID | None = None,
) -> TransitionResult:
    """Validate status transition rules, permissions, and required inputs cleanly."""
    if target_status not in TASK_STATUSES:
        raise AppError("invalid_transition", f"Unknown task status '{target_status}'", 400)
    if target_status == state.status:
        raise AppError("invalid_transition", f"Task is already in '{target_status}'", 400)

    structural = _structural_edges(state)
    matched = [(t, act) for t, act in structural if t == target_status]
    if not matched:
        raise AppError(
            "invalid_transition",
            f"Cannot transition from '{state.status}' to '{target_status}'",
            status_code=400,
        )

    chosen_action: str | None = None
    chosen_acted_as: str | None = None
    chosen_on_behalf = False
    for _, action in matched:
        via, on_behalf = _grant_for_edge(state.status, action, actor)
        if via is not None:
            chosen_action = action
            chosen_acted_as = via
            chosen_on_behalf = on_behalf
            break

    if chosen_action is None or chosen_acted_as is None:
        raise AppError(
            "forbidden",
            f"Permission denied for transition '{state.status}' -> '{target_status}'",
            status_code=403,
        )

    clean_comment = (comment or "").strip()
    if chosen_action in {"retake", "reopen"} and not clean_comment:
        raise AppError(
            "validation_error",
            "A comment is required when sending a task back for retake or reopening",
            status_code=400,
        )

    if (
        chosen_action == "submit"
        and policy.require_version_to_submit
        and version_id is None
        and not state.has_version
    ):
        raise AppError(
            "validation_error",
            "A published version is required before submitting for review",
            status_code=400,
        )

    review_stage: str | None = None
    review_decision: str | None = None
    if chosen_action == "submit":
        if target_status in REVIEW_STATUSES:
            _, review_stage = _stage_perm_for_status(target_status)
            review_decision = "pending"
    elif chosen_action == "approve":
        _, review_stage = _stage_perm_for_status(state.status)
        review_decision = "approved"
    elif chosen_action == "retake":
        _, review_stage = _stage_perm_for_status(state.status)
        review_decision = "retake"

    new_status_before_hold: str | None = state.status_before_hold
    if chosen_action == "hold":
        new_status_before_hold = state.status
    elif chosen_action == "resume":
        new_status_before_hold = None

    set_actual_start = (
        state.status in {"RDY", "RTK"} and target_status == "IP" and not state.actual_start_set
    )
    set_actual_finish = target_status == "APP"
    clear_actual_finish = target_status == "RTK"
    increment_retake = chosen_action == "retake"
    set_approved_version = target_status == "APP"
    auto_share_client = target_status == "P_CLIENT"

    return TransitionResult(
        from_status=state.status,
        to_status=target_status,
        action=chosen_action,
        acted_as=chosen_acted_as,
        on_behalf_of_client=chosen_on_behalf,
        review_stage=review_stage,
        review_decision=review_decision,
        status_before_hold=new_status_before_hold,
        set_actual_start=set_actual_start,
        set_actual_finish=set_actual_finish,
        clear_actual_finish=clear_actual_finish,
        increment_retake=increment_retake,
        set_approved_version=set_approved_version,
        auto_share_client=auto_share_client,
    )


def compute_rollup_status(statuses: Sequence[str]) -> str:
    """Compute Matrix collapsed department rollup status per CR03 §10.2."""
    clean = [s for s in statuses if s in TASK_STATUSES]
    if not clean:
        return "WTG"
    if "RTK" in clean:
        return "RTK"
    for stage in ("P_LEAD", "P_SUP", "P_CLIENT"):
        if stage in clean:
            return stage
    if all(s == "APP" for s in clean):
        return "APP"
    non_app = [s for s in clean if s != "APP"]
    if non_app and all(s == "HLD" for s in non_app):
        return "HLD"
    # Otherwise lowest progression among non-APP, non-HLD tasks: WTG < RDY < IP
    for candidate in ("WTG", "RDY", "IP"):
        if candidate in non_app:
            return candidate
    return "WTG"


def compute_bid_days(bid_hours: float | None, hours_per_day: float = 8.0) -> float | None:
    """Convert stored hours to display days using project hours_per_day."""
    if bid_hours is None:
        return None
    denom = hours_per_day if hours_per_day > 0 else 8.0
    return round(bid_hours / denom, 2)
