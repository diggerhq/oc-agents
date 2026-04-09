import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useOrg } from '@/stores/org';
import type { Organization } from '@/lib/api';

// Helper to get display name for an org
function getOrgDisplayName(org: Organization, short = false): string {
  if (org.is_personal) {
    return short ? 'Personal' : 'Personal Workspace';
  }
  return org.name;
}

export function OrgSwitcher() {
  const { 
    currentOrg, 
    organizations, 
    pendingInvitations,
    switchOrganization,
    fetchPendingInvitations,
    acceptInvitation,
    declineInvitation,
  } = useOrg();
  const [isOpen, setIsOpen] = useState(false);
  const [processingInvite, setProcessingInvite] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch pending invitations on mount
  useEffect(() => {
    fetchPendingInvitations();
  }, [fetchPendingInvitations]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSwitch = async (orgId: string) => {
    try {
      await switchOrganization(orgId);
      setIsOpen(false);
      // Reload the page to refresh data with new org context
      window.location.reload();
    } catch (error) {
      console.error('Failed to switch org:', error);
    }
  };

  const handleAcceptInvite = async (inviteId: string) => {
    setProcessingInvite(inviteId);
    try {
      await acceptInvitation(inviteId);
      setIsOpen(false);
      // Reload to refresh with new org context
      window.location.reload();
    } catch (error) {
      console.error('Failed to accept invite:', error);
    } finally {
      setProcessingInvite(null);
    }
  };

  const handleDeclineInvite = async (inviteId: string) => {
    setProcessingInvite(inviteId);
    try {
      await declineInvitation(inviteId);
    } catch (error) {
      console.error('Failed to decline invite:', error);
    } finally {
      setProcessingInvite(null);
    }
  };

  if (!currentOrg) return null;

  const isPersonal = Boolean(currentOrg.is_personal);
  const displayName = getOrgDisplayName(currentOrg, true); // Short version for button

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Compact trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md transition-colors bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700"
      >
        {/* Org Icon */}
        <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-semibold flex-shrink-0 ${
          isPersonal 
            ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white' 
            : 'bg-gradient-to-br from-purple-500 to-pink-600 text-white'
        }`}>
          {isPersonal ? (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          ) : (
            currentOrg.name.charAt(0).toUpperCase()
          )}
        </div>
        
        <span className="flex-1 min-w-0 text-left font-medium text-slate-700 dark:text-slate-200 truncate">
          {displayName}
        </span>
        
        {/* Pending invitations badge */}
        {pendingInvitations.length > 0 && (
          <span className="w-4 h-4 flex items-center justify-center bg-orange-500 text-white text-[9px] font-bold rounded-full flex-shrink-0">
            {pendingInvitations.length}
          </span>
        )}
        
        {/* Chevron */}
        <svg 
          className={`w-3 h-3 text-slate-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute left-0 bottom-full mb-2 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-slate-100 dark:border-slate-700">
            <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Workspaces</p>
          </div>
          
          <div className="max-h-40 overflow-y-auto py-0.5">
            {organizations.map((org) => {
              const orgIsPersonal = Boolean(org.is_personal);
              const isSelected = org.id === currentOrg.id;
              const orgDisplayName = getOrgDisplayName(org, false); // Full name in dropdown
              
              return (
                <button
                  key={org.id}
                  onClick={() => handleSwitch(org.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
                    isSelected 
                      ? 'bg-blue-50 dark:bg-blue-900/20' 
                      : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-semibold flex-shrink-0 ${
                    orgIsPersonal 
                      ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white' 
                      : 'bg-gradient-to-br from-purple-500 to-pink-600 text-white'
                  }`}>
                    {orgIsPersonal ? (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    ) : (
                      org.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs truncate ${
                      isSelected 
                        ? 'font-medium text-blue-700 dark:text-blue-400' 
                        : 'text-slate-700 dark:text-slate-200'
                    }`}>
                      {orgDisplayName}
                    </p>
                    {org.role && !orgIsPersonal && (
                      <p className="text-[9px] text-slate-500 dark:text-slate-400">{org.role}</p>
                    )}
                  </div>
                  
                  {isSelected && (
                    <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          
          {/* Pending Invitations */}
          {pendingInvitations.length > 0 && (
            <>
              <div className="px-2.5 py-1.5 border-t border-slate-100 dark:border-slate-700">
                <p className="text-[9px] font-medium text-orange-500 uppercase tracking-wider flex items-center gap-1">
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Invitations
                </p>
              </div>
              <div className="py-0.5">
                {pendingInvitations.map((invite) => (
                  <div
                    key={invite.id}
                    className="mx-1.5 mb-1 px-2 py-1.5 rounded bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/30"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-5 h-5 rounded flex items-center justify-center bg-orange-500 text-white text-[10px] font-semibold">
                        {invite.organization_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-slate-900 dark:text-white truncate">{invite.organization_name}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleAcceptInvite(invite.id)}
                        disabled={processingInvite === invite.id}
                        className="flex-1 px-1.5 py-0.5 text-[9px] font-medium bg-green-500 text-white hover:bg-green-600 rounded transition-colors disabled:opacity-50"
                      >
                        {processingInvite === invite.id ? '...' : 'Accept'}
                      </button>
                      <button
                        onClick={() => handleDeclineInvite(invite.id)}
                        disabled={processingInvite === invite.id}
                        className="flex-1 px-1.5 py-0.5 text-[9px] font-medium bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-500 rounded transition-colors disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          
          <div className="border-t border-slate-100 dark:border-slate-700 py-0.5">
            <Link
              to="/settings/organization"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </Link>
            
            <button
              onClick={() => {
                setIsOpen(false);
                window.location.href = '/settings/organization?create=true';
              }}
              className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
