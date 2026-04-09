import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { organizations } from '@/lib/api';

export function AcceptInvitation() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  
  const [invitation, setInvitation] = useState<{
    email: string;
    role: string;
    organization_name: string;
    expires_at: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  // Fetch invitation details
  useEffect(() => {
    if (!token) return;
    
    async function fetchInvitation() {
      try {
        const data = await organizations.getInvitation(token!);
        setInvitation(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load invitation');
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchInvitation();
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    
    setIsAccepting(true);
    setError(null);
    
    try {
      await organizations.acceptInvitation(token);
      setAccepted(true);
      // Redirect to org settings after a delay
      setTimeout(() => {
        navigate('/settings/organization');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setIsAccepting(false);
    }
  };

  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Invalid Invitation</h1>
          <p className="text-muted mb-6">{error}</p>
          <Link
            to="/"
            className="inline-block px-6 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Welcome!</h1>
          <p className="text-muted">
            You've joined <span className="text-white font-medium">{invitation?.organization_name}</span>
          </p>
          <p className="text-muted text-sm mt-2">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">
            You're invited to join
          </h1>
          <p className="text-2xl font-bold text-purple-400">
            {invitation?.organization_name}
          </p>
        </div>
        
        <div className="bg-white/5 rounded-lg p-4 mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-muted text-sm">Invited as</span>
            <span className={`px-2 py-1 rounded text-sm ${
              invitation?.role === 'admin' 
                ? 'bg-green-500/20 text-green-400' 
                : 'bg-gray-500/20 text-gray-400'
            }`}>
              {invitation?.role?.charAt(0).toUpperCase()}{invitation?.role?.slice(1)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted text-sm">Email</span>
            <span className="text-white text-sm">{invitation?.email}</span>
          </div>
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
        
        {isAuthenticated ? (
          <button
            onClick={handleAccept}
            disabled={isAccepting}
            className="w-full py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            {isAccepting ? 'Accepting...' : 'Accept Invitation'}
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-center text-muted text-sm">
              Sign in to accept this invitation
            </p>
            <button
              onClick={login}
              className="w-full py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition-colors"
            >
              Sign In
            </button>
          </div>
        )}
        
        <p className="text-center text-muted text-xs mt-4">
          Expires {invitation?.expires_at ? new Date(invitation.expires_at).toLocaleDateString() : 'soon'}
        </p>
      </div>
    </div>
  );
}

export default AcceptInvitation;
