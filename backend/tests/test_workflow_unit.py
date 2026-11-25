from __future__ import annotations

from datetime import date
from uuid import UUID

import pytest

from app.core.errors import AppError
from app.services.workflow import (
    TASK_STATUSES,
    TaskWorkflowState,
    WorkflowActor,
    WorkflowPolicy,
    compute_bid_days,
    compute_rollup_status,
    evaluate_allowed_transitions,
    first_review_stage,
    is_dependency_satisfied,
    next_review_stage,
    validate_transition,
)
from app.services.workload import (
    WorkloadTaskInput,
    WorkloadTimeLogInput,
    WorkloadUserInput,
    compute_workload_grid,
)

VER_1 = UUID("00000000-0000-0000-0000-000000000001")
U_ART = UUID("00000000-0000-0000-0000-000000000011")
U_ART2 = UUID("00000000-0000-0000-0000-000000000012")
DEPT_A = UUID("00000000-0000-0000-0000-000000000021")
TASK_1 = UUID("00000000-0000-0000-0000-000000000031")
TASK_2 = UUID("00000000-0000-0000-0000-000000000032")


def test_dependency_thresholds() -> None:
    assert is_dependency_satisfied("WTG", False, "ANY_STATUS") is True
    assert is_dependency_satisfied("IP", False, "PUBLISHED") is False
    assert is_dependency_satisfied("IP", True, "PUBLISHED") is True
    assert is_dependency_satisfied("APP", False, "PUBLISHED") is True
    assert is_dependency_satisfied("P_CLIENT", True, "APP") is False
    assert is_dependency_satisfied("APP", False, "APP") is True


def test_review_stage_routing() -> None:
    s_all = TaskWorkflowState(
        status="IP", needs_lead_review=True, needs_sup_review=True, needs_client_review=True
    )
    assert first_review_stage(s_all) == "P_LEAD"
    assert next_review_stage("P_LEAD", s_all) == "P_SUP"
    assert next_review_stage("P_SUP", s_all) == "P_CLIENT"
    assert next_review_stage("P_CLIENT", s_all) == "APP"

    s_sup_only = TaskWorkflowState(
        status="IP", needs_lead_review=False, needs_sup_review=True, needs_client_review=False
    )
    assert first_review_stage(s_sup_only) == "P_SUP"
    assert next_review_stage("P_SUP", s_sup_only) == "APP"

    s_none = TaskWorkflowState(
        status="IP", needs_lead_review=False, needs_sup_review=False, needs_client_review=False
    )
    assert first_review_stage(s_none) == "APP"


def test_allowed_and_forbidden_transitions_across_all_pairs() -> None:
    admin_actor = WorkflowActor(
        role_name="admin",
        grants={
            "task.status.force": "role:admin",
            "task.status.start": "role:admin",
            "task.status.submit": "role:admin",
            "task.status.hold": "role:admin",
            "task.status.reopen": "role:admin",
            "task.approve.lead": "role:admin",
            "task.approve.sup": "role:admin",
            "task.approve.client": "role:admin",
        },
    )
    expected_valid: dict[str, set[str]] = {
        "WTG": {"RDY", "HLD"},
        "RDY": {"IP", "HLD"},
        "IP": {"P_LEAD", "HLD"},
        "RTK": {"IP", "P_LEAD", "HLD"},
        "P_LEAD": {"P_SUP", "RTK", "HLD"},
        "P_SUP": {"P_CLIENT", "RTK", "HLD"},
        "P_CLIENT": {"APP", "RTK", "HLD"},
        "APP": {"RTK", "HLD"},
        "HLD": {"IP"},  # when status_before_hold="IP"
    }
    policy = WorkflowPolicy(require_version_to_submit=True)
    for src in TASK_STATUSES:
        state = TaskWorkflowState(
            status=src,
            status_before_hold="IP" if src == "HLD" else None,
            needs_lead_review=True,
            needs_sup_review=True,
            needs_client_review=True,
            has_version=True,
        )
        opts = {o.to for o in evaluate_allowed_transitions(state, admin_actor, policy)}
        assert opts == expected_valid[src]
        for dst in TASK_STATUSES:
            if dst in expected_valid[src]:
                res = validate_transition(
                    state, admin_actor, policy, dst, comment="ok", version_id=VER_1
                )
                assert res.to_status == dst
            else:
                with pytest.raises(AppError) as err:
                    validate_transition(
                        state, admin_actor, policy, dst, comment="ok", version_id=VER_1
                    )
                assert err.value.status_code == 400


def test_transition_requirements_permissions_and_overrides() -> None:
    policy = WorkflowPolicy(require_version_to_submit=True)
    ip_no_ver = TaskWorkflowState(status="IP", has_version=False)
    do_actor = WorkflowActor(
        role_name="artist",
        grants={"task.status.start": "capacity:artist", "task.status.submit": "capacity:artist"},
    )
    with pytest.raises(AppError) as err_ver:
        validate_transition(ip_no_ver, do_actor, policy, "P_LEAD")
    assert err_ver.value.status_code == 400

    # No-version submit works when policy.require_version_to_submit is False
    sub = validate_transition(
        ip_no_ver, do_actor, WorkflowPolicy(require_version_to_submit=False), "P_LEAD"
    )
    assert sub.to_status == "P_LEAD"
    assert sub.acted_as == "capacity:artist"

    # Retake requires comment
    p_lead = TaskWorkflowState(status="P_LEAD", has_version=True)
    lead_actor = WorkflowActor(role_name="lead", grants={"task.approve.lead": "role:lead"})
    with pytest.raises(AppError) as err_cmt:
        validate_transition(p_lead, lead_actor, policy, "RTK", comment="  ")
    assert err_cmt.value.status_code == 400
    rtk = validate_transition(p_lead, lead_actor, policy, "RTK", comment="Fix silhouette")
    assert rtk.increment_retake is True
    assert rtk.clear_actual_finish is True

    # Director approves ALL 3 stages with acted_as='role:director';
    # Producer approves client on_behalf
    director_actor = WorkflowActor(
        role_name="director",
        grants={
            "task.approve.lead": "role:director",
            "task.approve.sup": "role:director",
            "task.approve.client": "role:director",
        },
    )
    p_client = TaskWorkflowState(status="P_CLIENT", needs_client_review=True, has_version=True)
    dir_app = validate_transition(p_client, director_actor, policy, "APP")
    assert dir_app.acted_as == "role:director"
    assert dir_app.on_behalf_of_client is False

    producer_actor = WorkflowActor(
        role_name="producer", grants={"task.approve.client": "role:producer"}
    )
    prod_app = validate_transition(p_client, producer_actor, policy, "APP")
    assert prod_app.acted_as == "on_behalf"
    assert prod_app.on_behalf_of_client is True
    assert prod_app.set_approved_version is True
    assert prod_app.set_actual_finish is True

    # Capacity permission denial check for plain artist without approve grant
    with pytest.raises(AppError) as err_perm:
        validate_transition(p_lead, do_actor, policy, "APP", comment="try")
    # Structural edge from P_LEAD goes to SUP (APP when only lead review enabled)
    p_lead_only = TaskWorkflowState(
        status="P_LEAD", needs_sup_review=False, needs_client_review=False
    )
    with pytest.raises(AppError) as err_forbidden:
        validate_transition(p_lead_only, do_actor, policy, "APP")
    assert err_forbidden.value.status_code == 403
    assert err_perm.value.status_code in (400, 403)


def test_rollup_status_and_bid_days() -> None:
    assert compute_rollup_status(["APP", "RTK", "IP"]) == "RTK"
    assert compute_rollup_status(["APP", "P_SUP", "IP"]) == "P_SUP"
    assert compute_rollup_status(["APP", "APP"]) == "APP"
    assert compute_rollup_status(["APP", "HLD"]) == "HLD"
    assert compute_rollup_status(["IP", "RDY", "WTG"]) == "WTG"
    assert compute_rollup_status(["IP", "RDY"]) == "RDY"
    assert compute_rollup_status(["IP", "APP"]) == "IP"
    assert compute_bid_days(16.0, 8.0) == 2.0
    assert compute_bid_days(10.0, 8.0) == 1.25
    assert compute_bid_days(None, 8.0) is None


def test_workload_math_artist_only_past_logs_and_unscheduled() -> None:
    u1 = WorkloadUserInput(U_ART, "sam", "Sam", 8.0, None, (DEPT_A,))
    u2 = WorkloadUserInput(U_ART2, "lee", "Lee", 8.0, None, (DEPT_A,))
    # Mon Nov 23 .. Fri Nov 27 (today = Wed Nov 25 -> 3 working days Wed/Thu/Fri)
    today = date(2026, 11, 25)
    t_sched_unused = WorkloadTaskInput(
        id=TASK_1,
        task_code="HERO_MOD_main",
        status="IP",
        department_id=DEPT_A,
        ideal_start_date=date(2026, 11, 24),
        ideal_finish_date=date(2026, 11, 27),
        bid_hours=20.0,
        logged_hours=4.0,
        artist_user_ids=(U_ART, U_ART2),
    )
    assert t_sched_unused.bid_hours == 20.0
    # Use 12h remaining across 1 artist over 3 days = 4h/day
    t_sched = WorkloadTaskInput(
        id=TASK_1,
        task_code="HERO_MOD_main",
        status="IP",
        department_id=DEPT_A,
        ideal_start_date=date(2026, 11, 24),
        ideal_finish_date=date(2026, 11, 27),
        bid_hours=16.0,
        logged_hours=4.0,  # 12h remaining -> 4h/day on Wed, Thu, Fri
        artist_user_ids=(U_ART,),
    )
    t_unsched = WorkloadTaskInput(
        id=TASK_2,
        task_code="HERO_MOD_unsched",
        status="RDY",
        department_id=DEPT_A,
        ideal_start_date=None,
        ideal_finish_date=None,
        bid_hours=8.0,
        logged_hours=0.0,
        artist_user_ids=(U_ART2,),
    )
    logs = [
        WorkloadTimeLogInput(task_id=TASK_1, user_id=U_ART, work_date=date(2026, 11, 24), hours=4.0)
    ]
    res = compute_workload_grid(
        [u1, u2],
        [t_sched, t_unsched],
        logs,
        date_from=date(2026, 11, 23),
        date_to=date(2026, 11, 29),
        working_days={1, 2, 3, 4, 5},
        today=today,
    )
    assert res.unscheduled_task_ids == [TASK_2]
    sam_cells = {c.day: c for c in res.rows[0].cells}
    assert sam_cells[date(2026, 11, 24)].hours == 4.0  # past time log
    assert sam_cells[date(2026, 11, 24)].utilization_pct == 50.0
    assert sam_cells[date(2026, 11, 25)].hours == 4.0  # spread remaining 12h / 3 days
    assert sam_cells[date(2026, 11, 26)].hours == 4.0
    assert sam_cells[date(2026, 11, 27)].hours == 4.0
    assert sam_cells[date(2026, 11, 28)].hours == 0.0  # weekend non-working day
    assert sam_cells[date(2026, 11, 29)].hours == 0.0
