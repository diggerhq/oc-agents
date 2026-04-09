import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

export function Login() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  useEffect(() => {
    // If no error, redirect to WorkOS login
    if (!error) {
      window.location.href = '/api/auth/workos/login';
    }
  }, [error]);

  if (error) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <h1 className="text-2xl font-medium mb-4">Authentication Failed</h1>
          <p className="text-muted mb-6">
            {error === 'no_code' && 'No authorization code received.'}
            {error === 'auth_failed' && 'Authentication failed. Please try again.'}
            {!['no_code', 'auth_failed'].includes(error) && 'An error occurred during login.'}
          </p>
          <button
            onClick={() => window.location.href = '/api/auth/workos/login'}
            className="bg-white text-black px-6 py-2.5 rounded text-sm font-medium hover:bg-gray-200"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-6">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-muted">Redirecting to login...</p>
      </div>
    </div>
  );
}
