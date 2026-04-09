import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useOrg, useCanAdmin, useIsOwner } from '@/stores/org';
import { organizations, OrganizationMember, OrganizationInvitation, OrgRole } from '@/lib/api';

export function OrgSettings() {
  const [searchParams] = useSearchParams();
  const { currentOrg, organizations: orgs, fetchOrganizations, createOrganization, switchOrganization } = useOrg();
  const canAdmin = useCanAdmin();
  const isOwner = useIsOwner();
  
  // State
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modals
  const [showCreateModal, setShowCreateModal] = useState(searchParams.get('create') === 'true');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  
  // Form state
  const [newOrgName, setNewOrgName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch members and invitations
  useEffect(() => {
    if (!currentOrg) return;
    const orgId = currentOrg.id;
    
    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const [membersData, invitationsData] = await Promise.all([
          organizations.listMembers(orgId),
          canAdmin ? organizations.listInvitations(orgId) : Promise.resolve([]),
        ]);
        setMembers(membersData);
        setInvitations(invitationsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setIsLoading(false);
      }
    }
    
    loadData();
  }, [currentOrg, canAdmin]);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    
    setIsSubmitting(true);
    try {
      const newOrg = await createOrganization(newOrgName.trim());
      setShowCreateModal(false);
      setNewOrgName('');
      // Switch to the new org
      await switchOrganization(newOrg.id);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !currentOrg) return;
    
    setIsSubmitting(true);
    try {
      const invitation = await organizations.sendInvitation(currentOrg.id, inviteEmail.trim(), inviteRole);
      setInvitations([...invitations, invitation]);
      setShowInviteModal(false);
      setInviteEmail('');
      setInviteRole('member');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: OrgRole) => {
    if (!currentOrg) return;
    try {
      await organizations.updateMemberRole(currentOrg.id, userId, newRole);
      setMembers(members.map(m => m.user_id === userId ? { ...m, role: newRole } : m));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!currentOrg || !confirm('Are you sure you want to remove this member?')) return;
    try {
      await organizations.removeMember(currentOrg.id, userId);
      setMembers(members.filter(m => m.user_id !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  const handleRevokeInvitation = async (inviteId: string) => {
    if (!currentOrg) return;
    try {
      await organizations.revokeInvitation(currentOrg.id, inviteId);
      setInvitations(invitations.filter(i => i.id !== inviteId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invitation');
    }
  };

  const handleDeleteOrg = async () => {
    if (!currentOrg) return;
    try {
      await organizations.delete(currentOrg.id);
      await fetchOrganizations();
      // Switch to personal org
      const personalOrg = orgs.find(o => o.is_personal);
      if (personalOrg) {
        await switchOrganization(personalOrg.id);
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete organization');
    }
  };

  const isPersonal = currentOrg?.is_personal;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white mb-8">Organization Settings</h1>
      
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}
      
      {/* Current Organization */}
      {currentOrg && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-medium ${
                isPersonal ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
              }`}>
                {isPersonal ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                ) : (
                  currentOrg.name.charAt(0).toUpperCase()
                )}
              </div>
              <div>
                <h2 className="text-lg font-medium text-slate-900 dark:text-white">{currentOrg.name}</h2>
                <p className="text-sm text-muted">
                  {isPersonal ? 'Personal workspace' : `Slug: ${currentOrg.slug}`}
                </p>
              </div>
            </div>
            {currentOrg.role && (
              <span className={`px-3 py-1 rounded-full text-sm ${
                currentOrg.role === 'owner' 
                  ? 'bg-yellow-500/20 text-yellow-400' 
                  : currentOrg.role === 'admin'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-gray-500/20 text-gray-400'
              }`}>
                {currentOrg.role.charAt(0).toUpperCase() + currentOrg.role.slice(1)}
              </span>
            )}
          </div>
        </div>
      )}
      
      {/* Members Section */}
      {!isPersonal && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-slate-900 dark:text-white">Members</h3>
            {canAdmin && (
              <button
                onClick={() => setShowInviteModal(true)}
                className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Invite Member
              </button>
            )}
          </div>
          
          {isLoading ? (
            <p className="text-muted text-sm">Loading members...</p>
          ) : (
            <div className="space-y-3">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-purple-500/20 text-purple-400 rounded-full flex items-center justify-center text-sm font-medium">
                      {member.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-slate-900 dark:text-white text-sm">{member.email}</p>
                      <p className="text-muted text-xs capitalize">{member.role}</p>
                    </div>
                  </div>
                  
                  {canAdmin && member.role !== 'owner' && (
                    <div className="flex items-center gap-2">
                      <select
                        value={member.role}
                        onChange={(e) => handleUpdateRole(member.user_id, e.target.value as OrgRole)}
                        className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-sm text-slate-900 dark:text-white"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button
                        onClick={() => handleRemoveMember(member.user_id)}
                        className="p-1 text-red-400 hover:bg-red-500/10 rounded"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* Pending Invitations */}
      {!isPersonal && canAdmin && invitations.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Pending Invitations</h3>
          <div className="space-y-3">
            {invitations.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg"
              >
                <div>
                  <p className="text-slate-900 dark:text-white text-sm">{invite.email}</p>
                  <p className="text-muted text-xs capitalize">
                    {invite.role} - Expires {new Date(invite.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => handleRevokeInvitation(invite.id)}
                  className="text-sm text-red-400 hover:text-red-300"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* All Organizations */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-slate-900 dark:text-white">Your Organizations</h3>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-muted hover:text-slate-900 dark:text-white hover:bg-white/5 transition-colors"
          >
            Create New
          </button>
        </div>
        
        <div className="space-y-2">
          {orgs.map((org) => {
            const orgIsPersonal = Boolean(org.is_personal);
            const isCurrent = org.id === currentOrg?.id;
            
            return (
              <button
                key={org.id}
                onClick={() => {
                  if (!isCurrent) {
                    switchOrganization(org.id).then(() => window.location.reload());
                  }
                }}
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
                  isCurrent 
                    ? 'bg-white/10 border border-white/20' 
                    : 'hover:bg-white/5 border border-transparent'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-medium ${
                  orgIsPersonal ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                }`}>
                  {orgIsPersonal ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  ) : (
                    org.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-slate-900 dark:text-white text-sm">{org.name}</p>
                  <p className="text-muted text-xs capitalize">{org.role}</p>
                </div>
                {isCurrent && (
                  <span className="text-xs text-green-400">Current</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      
      {/* Danger Zone */}
      {!isPersonal && isOwner && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-6">
          <h3 className="text-lg font-medium text-red-400 mb-2">Danger Zone</h3>
          <p className="text-sm text-muted mb-4">
            Once you delete an organization, there is no going back. Please be certain.
          </p>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-sm hover:bg-red-500/30 transition-colors"
          >
            Delete Organization
          </button>
        </div>
      )}
      
      {/* Create Organization Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Create Organization</h2>
            <form onSubmit={handleCreateOrg}>
              <input
                type="text"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Organization name"
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 mb-4"
                autoFocus
              />
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-muted hover:text-slate-900 dark:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newOrgName.trim()}
                  className="px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Invite Member Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Invite Member</h2>
            <form onSubmit={handleInvite}>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Email address"
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 mb-4"
                autoFocus
              />
              <div className="mb-4">
                <label className="block text-sm text-muted mb-2">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                >
                  <option value="member">Member</option>
                  {isOwner && <option value="admin">Admin</option>}
                </select>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 text-muted hover:text-slate-900 dark:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !inviteEmail.trim()}
                  className="px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? 'Sending...' : 'Send Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Delete Organization Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-medium text-red-400 mb-4">Delete Organization</h2>
            <p className="text-muted text-sm mb-4">
              Are you sure you want to delete <strong className="text-slate-900 dark:text-white">{currentOrg?.name}</strong>? 
              This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 text-muted hover:text-slate-900 dark:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteOrg}
                className="px-4 py-2 bg-red-500 text-slate-900 dark:text-white rounded-lg font-medium hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrgSettings;
