import { useState } from 'react';
import { api } from '@/lib/api';
import { useOrg } from '@/stores/org';

export type ResourceVisibility = 'org' | 'private' | 'role';
export type OrgRole = 'owner' | 'admin' | 'member';

interface ShareResourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  resourceType: 'session' | 'workflow' | 'bucket' | 'knowledge_base' | 'integration';
  resourceId: string;
  resourceName: string;
  currentVisibility?: ResourceVisibility;
  currentMinRole?: OrgRole;
  onUpdate?: (visibility: ResourceVisibility, minRole: OrgRole) => void;
}

export function ShareResourceModal({
  isOpen,
  onClose,
  resourceType,
  resourceId,
  resourceName,
  currentVisibility = 'org',
  currentMinRole = 'member',
  onUpdate,
}: ShareResourceModalProps) {
  const { currentOrg } = useOrg();
  
  const [visibility, setVisibility] = useState<ResourceVisibility>(currentVisibility);
  const [minRole, setMinRole] = useState<OrgRole>(currentMinRole);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPersonalOrg = Boolean(currentOrg?.is_personal);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    
    try {
      await api.patch(`/organizations/resources/${resourceType}/${resourceId}/permissions`, {
        visibility,
        min_role: visibility === 'role' ? minRole : undefined,
      });
      
      onUpdate?.(visibility, minRole);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update permissions');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Share Settings</h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
          Configure who can access <span className="text-slate-900 dark:text-white">{resourceName}</span>
        </p>
        
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
        
        {isPersonalOrg ? (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
            <p className="text-blue-400 text-sm">
              This resource is in your personal workspace. To share it with others, 
              move it to an organization.
            </p>
          </div>
        ) : (
          <div className="space-y-3 mb-6">
            {/* Organization (default) */}
            <label
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                visibility === 'org'
                  ? 'border-purple-500/50 bg-purple-500/10'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'org'}
                onChange={() => setVisibility('org')}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <span className="text-slate-900 dark:text-white font-medium">Organization</span>
                </div>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                  All members of {currentOrg?.name} can view and edit
                </p>
              </div>
            </label>
            
            {/* Role-based */}
            <label
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                visibility === 'role'
                  ? 'border-green-500/50 bg-green-500/10'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'role'}
                onChange={() => setVisibility('role')}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span className="text-slate-900 dark:text-white font-medium">Role-based</span>
                </div>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                  Only members with specific roles can access
                </p>
                
                {visibility === 'role' && (
                  <div className="mt-3">
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Minimum role required</label>
                    <select
                      value={minRole}
                      onChange={(e) => setMinRole(e.target.value as OrgRole)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm"
                    >
                      <option value="member">Member (all members)</option>
                      <option value="admin">Admin (admins and owners)</option>
                      <option value="owner">Owner only</option>
                    </select>
                  </div>
                )}
              </div>
            </label>
            
            {/* Private */}
            <label
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                visibility === 'private'
                  ? 'border-yellow-500/50 bg-yellow-500/10'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'private'}
                onChange={() => setVisibility('private')}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="text-slate-900 dark:text-white font-medium">Private</span>
                </div>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                  Only you can access (hidden from other org members)
                </p>
              </div>
            </label>
          </div>
        )}
        
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white transition-colors"
          >
            Cancel
          </button>
          {!isPersonalOrg && (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ShareResourceModal;
