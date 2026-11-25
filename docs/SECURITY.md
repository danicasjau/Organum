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
`audit_log` records logins, login failures, logouts, password changes/resets, user/role/capacity/company changes, project lifecycle/status changes, task assignments, and client share changes.

