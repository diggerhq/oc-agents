import { create } from 'zustand';
import { auth, User } from '@/lib/api';
import { useOrg } from './org';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  // Redirect to WorkOS login
  login: () => {
    // If user just logged out, force fresh login to prevent auto-login
    const params = new URLSearchParams(window.location.search);
    const loggedOut = params.get('logged_out') === 'true';
    window.location.href = loggedOut
      ? '/api/auth/workos/login?prompt=login'
      : '/api/auth/workos/login';
  },

  logout: async () => {
    // Redirect to WorkOS logout endpoint (handles session cleanup and WorkOS signout)
    // Don't set state first - it triggers ProtectedRoute redirect which races with this
    window.location.href = '/api/auth/workos/logout';
  },

  checkAuth: async () => {
    try {
      const response = await auth.me();
      const { user, organizations, current_organization_id } = response;
      set({ user, isAuthenticated: true, isLoading: false });
      
      // Initialize org store with organizations from auth response
      if (organizations && organizations.length > 0) {
        useOrg.getState().initFromAuth(organizations, current_organization_id);
      }
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  register: async (email: string, password: string) => {
    const { user } = await auth.register(email, password);
    set({ user, isAuthenticated: true, isLoading: false });
    // After register, fetch organizations (personal org was created)
    useOrg.getState().fetchOrganizations();
  },
}));
