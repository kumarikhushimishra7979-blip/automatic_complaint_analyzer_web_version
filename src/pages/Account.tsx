import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import api, { extractErrorMessage } from '../services/api';
import { formatDateTime } from '../utils/formatters';
import { PageHeader } from '../components/PageHeader';
import { ErrorAlert } from '../components/ErrorAlert';

export function Account() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError('New password must be at least 8 characters and contain letters and numbers.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await api.put('/auth/password', {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setSuccess('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to update password.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Account"
        description="View your organizational profile details and update your account password."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Profile Details</h2>
          <dl className="divide-y divide-slate-100 text-sm">
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-500">Username</dt>
              <dd className="font-medium text-slate-900">{user?.username}</dd>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-500">Email Address</dt>
              <dd className="font-medium text-slate-900">{user?.email}</dd>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-500">Account ID</dt>
              <dd className="font-mono tabular-nums text-slate-700">#{user?.id}</dd>
            </div>
            <div className="py-3 flex justify-between gap-4">
              <dt className="text-slate-500">Registered On</dt>
              <dd className="font-mono tabular-nums text-xs text-slate-600">
                {formatDateTime(user?.created_at)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Change Password</h2>
          <form onSubmit={handlePasswordUpdate} className="space-y-4">
            <ErrorAlert message={error} onDismiss={() => setError(null)} />
            {success && (
              <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
                {success}
              </div>
            )}

            <div>
              <label htmlFor="cur-pw" className="block text-sm font-medium text-slate-700">
                Current Password
              </label>
              <input
                id="cur-pw"
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1.5 block w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
            </div>

            <div>
              <label htmlFor="new-pw" className="block text-sm font-medium text-slate-700">
                New Password
              </label>
              <input
                id="new-pw"
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1.5 block w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
            </div>

            <div>
              <label htmlFor="conf-pw" className="block text-sm font-medium text-slate-700">
                Confirm New Password
              </label>
              <input
                id="conf-pw"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1.5 block w-full px-3.5 py-2 text-sm border border-slate-300 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
