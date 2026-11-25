import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Spinner, ToastProvider, TooltipProvider } from '../components/ui';
import { ForcePasswordChangeDialog } from '../features/auth/ForcePasswordChangeDialog';
import { LoginPage } from '../features/auth/LoginPage';
import { DepartmentColorSync } from '../features/departments/DepartmentColorSync';
import { ReviewFeedbackSync } from '../features/reviews/ReviewFeedbackSync';
import { hasPerm, registerQueryClearer, useAuthStore } from '../features/auth/authStore';
import './App.css';

const ViewerPage = lazy(() =>
  import('../features/viewer/ViewerPage').then((m) => ({ default: m.ViewerPage })),
);
const TasksPage = lazy(() =>
  import('../features/tasks/TasksPage').then((m) => ({ default: m.TasksPage })),
);
const GalleryPage = lazy(() =>
  import('../gallery/GalleryPage').then((m) => ({ default: m.GalleryPage })),
);
const UsersPage = lazy(() =>
  import('../features/users/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const AdminPage = lazy(() =>
  import('../features/admin/AdminPage').then((m) => ({ default: m.AdminPage })),
);
const MyUserPage = lazy(() =>
  import('../features/me/MyUserPage').then((m) => ({ default: m.MyUserPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

registerQueryClearer((mode) => {
  void queryClient.cancelQueries();
  if (mode === 'clear') {
    queryClient.clear();
  }
});

export type ThemeMode = 'dark' | 'light';
export type DensityMode = 'compact' | 'comfortable';

function RequireAuth({
  requiredPerm,
  children,
}: {
  requiredPerm?: string | string[];
  children: ReactNode;
}) {
  const initialized = useAuthStore((s) => s.initialized);
  const auth = useAuthStore((s) => s.auth);

  if (!initialized) {
    return <Spinner label="Checking session" />;
  }
  if (!auth) {
    return <Navigate to="/login" replace />;
  }
  if (requiredPerm) {
    const perms = Array.isArray(requiredPerm) ? requiredPerm : [requiredPerm];
    if (!perms.some((p) => hasPerm(auth.permissions, p))) {
      return <Navigate to="/entities" replace />;
    }
  }
  return <>{children}</>;
}

export function App() {
  const bootstrapSession = useAuthStore((s) => s.bootstrapSession);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('organum.theme');
    return saved === 'light' ? 'light' : 'dark';
  });
  const [density, setDensity] = useState<DensityMode>('compact');
  const [redline, setRedline] = useState(false);

  useEffect(() => {
    void bootstrapSession();
  }, [bootstrapSession]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('organum.theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

  useEffect(() => {
    document.documentElement.setAttribute('data-redline', redline ? 'true' : 'false');
  }, [redline]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ToastProvider>
          <DepartmentColorSync />
          <ReviewFeedbackSync />
          <BrowserRouter>
            <Suspense fallback={<Spinner label="Loading module" />}>
              <Routes>
                <Route path="/" element={<Navigate to="/entities" replace />} />
                <Route
                  path="/login"
                  element={<LoginPage theme={theme} onToggleTheme={toggleTheme} />}
                />
                <Route
                  path="/entities"
                  element={
                    <RequireAuth>
                      <ViewerPage theme={theme} onToggleTheme={toggleTheme} />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/viewer"
                  element={
                    <RequireAuth>
                      <ViewerPage theme={theme} onToggleTheme={toggleTheme} />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/tasks"
                  element={
                    <RequireAuth requiredPerm="task.view">
                      <TasksPage theme={theme} onToggleTheme={toggleTheme} />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/users"
                  element={
                    <RequireAuth requiredPerm={['user.view', 'role.manage']}>
                      <UsersPage theme={theme} onToggleTheme={toggleTheme} />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/me"
                  element={
                    <RequireAuth>
                      <MyUserPage
                        theme={theme}
                        onToggleTheme={toggleTheme}
                        density={density}
                        onChangeDensity={setDensity}
                      />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <RequireAuth requiredPerm={['role.manage', 'rules.manage']}>
                      <AdminPage theme={theme} onToggleTheme={toggleTheme} />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/gallery"
                  element={
                    <GalleryPage
                      theme={theme}
                      onToggleTheme={toggleTheme}
                      density={density}
                      onToggleDensity={() =>
                        setDensity((d) => (d === 'compact' ? 'comfortable' : 'compact'))
                      }
                      redline={redline}
                      onToggleRedline={() => setRedline((r) => !r)}
                    />
                  }
                />
              </Routes>
              <ForcePasswordChangeDialog />
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
