import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { Layout } from '@/components/Layout';
import { Home } from '@/pages/Home';
import { Login } from '@/pages/Login';
import { Settings } from '@/pages/Settings';
import { Agents } from '@/pages/Agents';
import { SessionDetail } from '@/pages/SessionDetail';
import { Builder } from '@/pages/Builder';
import { Workflows } from '@/pages/Workflows';
import { Templates } from '@/pages/Templates';
import Approvals from '@/pages/Approvals';
// Integrations is now part of Settings
import { Files } from '@/pages/Files';
import { SharedThread } from '@/pages/SharedThread';
import { InsightsPortal } from '@/pages/InsightsPortal';
import { ChatPortal } from '@/pages/ChatPortal';
import { Knowledge } from '@/pages/Knowledge';
import { Observability } from '@/pages/Observability';
import { OrgSettings } from '@/pages/OrgSettings';
import { AcceptInvitation } from '@/pages/AcceptInvitation';
import PortalCustomizer from '@/pages/PortalCustomizer';
import { PortalAgentChat } from '@/pages/PortalAgentChat';
import { PortalSandboxAgentChat } from '@/pages/PortalSandboxAgentChat';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  return <>{children}</>;
}

export function App() {
  const { checkAuth, isLoading } = useAuth();

  // Check if this is a public portal route that doesn't need auth
  const isPublicPortalRoute = window.location.pathname.includes('/portal/') || 
                               window.location.pathname.includes('/portal-agent/') ||
                               window.location.pathname.includes('/portal-sandbox-agent/') ||
                               window.location.pathname.includes('/chat/') ||
                               window.location.pathname.includes('/insights/') ||
                               window.location.pathname.includes('/shared/');

  useEffect(() => {
    // Skip auth check for public portal/embed routes
    if (!isPublicPortalRoute) {
      checkAuth();
    }
  }, [checkAuth, isPublicPortalRoute]);

  // Don't show loading spinner for public portal routes - they handle their own loading
  if (isLoading && !isPublicPortalRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Public portal pages - outside Layout */}
        <Route path="/portal/:agentId" element={<InsightsPortal />} />
        <Route path="/portal/:agentId/shared/:shareToken" element={<SharedThread />} />
        <Route path="/portal-agent/:agentId" element={<PortalAgentChat />} />
        <Route path="/portal-sandbox-agent/:agentId" element={<PortalSandboxAgentChat />} />
        <Route path="/chat/:agentId" element={<ChatPortal />} />
        <Route path="/chat/:agentId/shared/:shareToken" element={<SharedThread />} />
        {/* Backwards compatibility */}
        <Route path="/insights/:agentId" element={<InsightsPortal />} />
        <Route path="/chat-portal/:agentId" element={<Navigate to="/chat/:agentId" replace />} />
        
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          {/* Register is now handled by WorkOS */}
          <Route path="/register" element={<Navigate to="/login" replace />} />
          <Route
            path="/builder"
            element={
              <ProtectedRoute>
                <Builder />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/organization"
            element={
              <ProtectedRoute>
                <OrgSettings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invitations/:token"
            element={<AcceptInvitation />}
          />
          <Route
            path="/agents"
            element={
              <ProtectedRoute>
                <Agents />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agents/:sessionId"
            element={
              <ProtectedRoute>
                <SessionDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agents/:sessionId/customize-portal"
            element={
              <ProtectedRoute>
                <PortalCustomizer />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workflows"
            element={
              <ProtectedRoute>
                <Workflows />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workflows/:workflowId"
            element={
              <ProtectedRoute>
                <Workflows />
              </ProtectedRoute>
            }
          />
          <Route
            path="/templates"
            element={
              <ProtectedRoute>
                <Templates />
              </ProtectedRoute>
            }
          />
          {/* Redirect /integrations to /settings (integrations tab) */}
          <Route
            path="/integrations"
            element={<Navigate to="/settings?tab=integrations" replace />}
          />
          <Route
            path="/files"
            element={
              <ProtectedRoute>
                <Files />
              </ProtectedRoute>
            }
          />
          <Route
            path="/knowledge"
            element={
              <ProtectedRoute>
                <Knowledge />
              </ProtectedRoute>
            }
          />
          <Route
            path="/observability"
            element={
              <ProtectedRoute>
                <Observability />
              </ProtectedRoute>
            }
          />
          <Route
            path="/approvals"
            element={
              <ProtectedRoute>
                <Approvals />
              </ProtectedRoute>
            }
          />
          {/* Redirect old routes */}
          <Route path="/sessions" element={<Navigate to="/agents" replace />} />
          <Route path="/sessions/:sessionId" element={<Navigate to="/agents/:sessionId" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
