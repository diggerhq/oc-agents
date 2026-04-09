import { create } from 'zustand';
import { organizations, Organization, OrgRole, PendingInvitation } from '@/lib/api';

interface OrgState {
  currentOrg: Organization | null;
  organizations: Organization[];
  pendingInvitations: PendingInvitation[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setCurrentOrg: (org: Organization) => void;
  setOrganizations: (orgs: Organization[]) => void;
  fetchOrganizations: () => Promise<void>;
  fetchPendingInvitations: () => Promise<void>;
  acceptInvitation: (inviteId: string) => Promise<void>;
  declineInvitation: (inviteId: string) => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  createOrganization: (name: string) => Promise<Organization>;
  initFromAuth: (orgs: Organization[], currentOrgId?: string) => void;
}

export const useOrg = create<OrgState>((set, get) => ({
  currentOrg: null,
  organizations: [],
  pendingInvitations: [],
  isLoading: false,
  error: null,

  setCurrentOrg: (org) => {
    set({ currentOrg: org });
  },

  setOrganizations: (orgs) => {
    set({ organizations: orgs });
  },

  fetchOrganizations: async () => {
    set({ isLoading: true, error: null });
    try {
      const orgs = await organizations.list();
      set({ organizations: orgs, isLoading: false });
      
      // If no current org selected, select the personal one or first one
      const { currentOrg } = get();
      if (!currentOrg && orgs.length > 0) {
        const personalOrg = orgs.find(o => o.is_personal);
        set({ currentOrg: personalOrg || orgs[0] });
      }
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to fetch organizations',
        isLoading: false 
      });
    }
  },

  fetchPendingInvitations: async () => {
    try {
      const invitations = await organizations.getMyInvitations();
      set({ pendingInvitations: invitations });
    } catch (error) {
      console.error('Failed to fetch pending invitations:', error);
      // Don't set error state for this, just log it
    }
  },

  acceptInvitation: async (inviteId: string) => {
    try {
      const result = await organizations.acceptInvitationById(inviteId);
      
      // Remove from pending invitations
      const { pendingInvitations } = get();
      set({ pendingInvitations: pendingInvitations.filter(i => i.id !== inviteId) });
      
      // Add the new org to the list and switch to it
      if (result.organization) {
        const { organizations: orgs } = get();
        const newOrg = { ...result.organization, role: result.role };
        set({ 
          organizations: [...orgs, newOrg],
          currentOrg: newOrg,
        });
        
        // Also call switchTo to update the backend session
        await organizations.switchTo(result.organization.id);
      }
    } catch (error) {
      console.error('Failed to accept invitation:', error);
      throw error;
    }
  },

  declineInvitation: async (inviteId: string) => {
    try {
      await organizations.declineInvitation(inviteId);
      
      // Remove from pending invitations
      const { pendingInvitations } = get();
      set({ pendingInvitations: pendingInvitations.filter(i => i.id !== inviteId) });
    } catch (error) {
      console.error('Failed to decline invitation:', error);
      throw error;
    }
  },

  switchOrganization: async (orgId: string) => {
    const { organizations: orgs } = get();
    const org = orgs.find(o => o.id === orgId);
    if (!org) return;

    try {
      await organizations.switchTo(orgId);
      set({ currentOrg: org });
    } catch (error) {
      console.error('Failed to switch organization:', error);
      throw error;
    }
  },

  createOrganization: async (name: string) => {
    const newOrg = await organizations.create(name);
    const { organizations: orgs } = get();
    set({ organizations: [...orgs, newOrg] });
    return newOrg;
  },

  initFromAuth: (orgs: Organization[], currentOrgId?: string) => {
    set({ organizations: orgs });
    
    if (currentOrgId) {
      const currentOrg = orgs.find(o => o.id === currentOrgId);
      if (currentOrg) {
        set({ currentOrg });
        return;
      }
    }
    
    // Default to personal org
    const personalOrg = orgs.find(o => o.is_personal);
    set({ currentOrg: personalOrg || orgs[0] || null });
  },
}));

// Helper hook to check if user has a specific role in current org
export function useOrgRole(): OrgRole | null {
  const currentOrg = useOrg(state => state.currentOrg);
  return currentOrg?.role || null;
}

// Helper hook to check if user can perform admin actions
export function useCanAdmin(): boolean {
  const role = useOrgRole();
  return role === 'owner' || role === 'admin';
}

// Helper hook to check if user is owner
export function useIsOwner(): boolean {
  const role = useOrgRole();
  return role === 'owner';
}
