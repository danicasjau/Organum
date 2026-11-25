# ORGANUM Security Architecture (CR03 Phase 7A)

## Password Storage & Policy
- **Hashing:** Argon2id (`argon2-cffi`, type `ID`) with per-hash cryptographic salt. Unknown-username logins run a constant-time dummy Argon2id verification to mitigate user enumeration timing leaks.
- **Policy:** Minimum 10 characters (max 256), cannot match the username (case-insensitive), and checked against a bundled common-password blocklist.
- **Initial Admin Seed:** Every newly created project seeds user `admin` ("Administrator") with initial password `magicadmin**` (or `ORGANUM_INITIAL_ADMIN_PASSWORD`), `must_change_password=true`, and `has_initial_password=true`. The initial password is never logged or stored in plaintext.
- **Non-Loopback Startup Guard:** If `ORGANUM_BIND_HOST` is non-loopback (`0.0.0.0`, LAN IP, etc.) while any active account in any known project still has `has_initial_password=true`, the server refuses to start.

## Sessions, CSRF & Origin Validation
- **Opaque Server-Side Sessions:** `sessions` table in `<project>/00_Pipeline/project.db` stores only the SHA-256 hash (`token_hash`) of an opaque 256-bit `secrets.token_urlsafe(32)` token.
- **Cookies:** `organum_session` (`HttpOnly`, `SameSite=Strict`, project-bound `<project_uuid>.<raw_token>`) and `organum_csrf` (`SameSite=Strict`).
- **Timeouts & Rotation:** 8-hour idle timeout (`last_seen_at`), 7-day absolute lifetime (`expires_at`). Session tokens rotate on login and on password change; logout and password reset/change revoke affected sessions immediately.
- **CSRF & Origin:** Every mutating HTTP request (`POST`, `PUT`, `PATCH`, `DELETE`) validates the `Origin` header (when present) against allowed origins / loopback rules AND requires `X-CSRF-Token` matching both the `organum_csrf` cookie and the server session's `csrf_token` via `hmac.compare_digest`.

## Brute-Force Protection & Localhost Launch Restrictions
- **Lockout:** 5 consecutive failed logins within 15 minutes trigger a 15-minute lockout keyed by `(project_uuid, username, client_ip)`. Errors are always generic (`Invalid credentials or account temporarily locked`).
- **Local Launch & Reveal:** `/launch`, `/reveal`, and `/fs/browse` remain strictly disabled on non-loopback bindings and rejected on non-loopback client IPs or cross-origin requests.

## Append-Only Audit Log
`audit_log` records logins, login failures, logouts, password changes/resets, user/role/capacity/company changes, project lifecycle/status changes, task assignments, client share changes, rule CRUD/apply operations, and every Admin Database Viewer / SQL Console inspection.

## Raw Read-Only Database Viewer & Optional SQL Console (Phase 7E)
- **Strict Admin Isolation:** All `/admin/db/*` endpoints require `admin` role and `admin.db` permission (`403` for Producer and all other roles).
- **Read-Only Connection & Engine Guard:** Opens `<project>/00_Pipeline/project.db` with SQLite `mode=ro` URI, `PRAGMA query_only = ON`, and an active `conn.set_authorizer(...)` allowing only `SQLITE_SELECT`, `SQLITE_READ`, `SQLITE_FUNCTION`, and `SQLITE_RECURSIVE` while denying all writes, DDL, `PRAGMA`, `ATTACH`, and transactions.
- **Authorizer-Level Redaction:** Sensitive columns (`users.password_hash`, `sessions.token_hash`, `sessions.csrf_token`) return `SQLITE_IGNORE` inside the authorizer (preventing alias or `WHERE` exfiltration) and serialize as `[REDACTED]` in both the Table Browser and SQL Console.
- **SQL Console Safety Caps:** Disabled by default (`project_meta.admin_sql_console_enabled = false`); single `SELECT`/`WITH` statements only, 5-second progress-handler timeout, and 1,000-row cap.

