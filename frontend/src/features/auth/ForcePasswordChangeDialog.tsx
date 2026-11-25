import { useState, type FormEvent } from 'react';
import { Banner, Button, Dialog, Panel, Stack, Text, TextField } from '../../components/ui';
import { apiClient } from '../../lib/api/client';
import { useAuthStore } from './authStore';
import './AuthPages.css';

export function ForcePasswordChangeDialog() {
  const auth = useAuthStore((s) => s.auth);
  const setAuth = useAuthStore((s) => s.setAuth);
  const logout = useAuthStore((s) => s.logout);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const open = Boolean(auth?.user.must_change_password);
  if (!open || !auth) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 10) {
      setError('Password must be at least 10 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const updated = await apiClient.changePassword(
        {
          current_password: currentPassword || null,
          new_password: newPassword,
        },
        auth.project_uuid,
      );
      setAuth(updated);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => { }} title="Password Change Required">
      <Panel title={`Update Password — ${auth.user.username}`}>
        <form onSubmit={handleSubmit} className="org-auth-form">
          <Stack gap="2">
            <Banner severity="warning">
              Your account uses an initial or temporary password. Set a new password (min 10
              characters, different from username) before continuing.
            </Banner>
            {error && <Banner severity="danger">{error}</Banner>}
            <label className="org-auth-field">
              <Text size="sm" variant="muted">Current Password (optional if initial)</Text>
              <TextField
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label className="org-auth-field">
              <Text size="sm" variant="muted">New Password</Text>
              <TextField
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            <label className="org-auth-field">
              <Text size="sm" variant="muted">Confirm New Password</Text>
              <TextField
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            <div className="org-auth-actions">
              <Button size="sm" onClick={() => void logout()} disabled={submitting}>
                Sign Out
              </Button>
              <Button type="submit" size="sm" variant="primary" disabled={submitting}>
                {submitting ? 'Updating...' : 'Set Password'}
              </Button>
            </div>
          </Stack>
        </form>
      </Panel>
    </Dialog>
  );
}
