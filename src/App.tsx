import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/AppLayout';
import { AuthPage } from '@/pages/AuthPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { GroupsPage } from '@/pages/GroupsPage';
import { CalendarPage } from '@/pages/CalendarPage';
import { CycleSettingsPage } from '@/pages/CycleSettingsPage';
import { MeetingsPage } from '@/pages/MeetingsPage';
import { TripsPage } from '@/pages/TripsPage';
import { ExpensesPage } from '@/pages/ExpensesPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { InvitePage } from '@/pages/InvitePage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { AboutPage, DocumentsPage, LegalDocumentPage } from '@/pages/LegalPages';
import { LegalFooter } from '@/components/LegalFooter';
import LandingPage from '@/pages/LandingPage';
import type { ReactNode } from 'react';

const queryClient = new QueryClient();

function RootRoute() {
  const { session, profile, loading } = useAuth();
  const { pathname } = useLocation();

  if (pathname === '/') {
    return <LandingPage />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <p className="text-stone-400">Загрузка…</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (profile && !profile.onboarding_completed && pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  return <AppLayout />;
}

function AppRoutes() {
  const { pathname } = useLocation();
  const isPublicRoute =
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/onboarding' ||
    pathname === '/documents' ||
    pathname === '/about' ||
    pathname.startsWith('/invite/') ||
    pathname.startsWith('/legal/');

  return (
    <>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/invite/:code" element={<InvitePage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/legal/:documentId" element={<LegalDocumentPage />} />

        <Route path="/" element={<RootRoute />}>
          <Route index element={<DashboardPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="cycle" element={<CycleSettingsPage />} />
          <Route path="meetings" element={<MeetingsPage />} />
          <Route path="trips" element={<TripsPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <LegalFooter inset={!isPublicRoute} />
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
