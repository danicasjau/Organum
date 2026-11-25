import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Spinner, ToastProvider, TooltipProvider } from '../components/ui';
import './App.css';

const ViewerPage = lazy(() =>
  import('../features/viewer/ViewerPage').then((m) => ({ default: m.ViewerPage })),
);
const GalleryPage = lazy(() =>
  import('../gallery/GalleryPage').then((m) => ({ default: m.GalleryPage })),
);

const queryClient = new QueryClient();

export type ThemeMode = 'dark' | 'light';
export type DensityMode = 'compact' | 'comfortable';

export function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('organum.theme');
    return saved === 'light' ? 'light' : 'dark';
  });
  const [density, setDensity] = useState<DensityMode>('compact');
  const [redline, setRedline] = useState(false);

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
          <BrowserRouter>
            <Suspense fallback={<Spinner label="Loading module" />}>
              <Routes>
                <Route path="/" element={<Navigate to="/entities" replace />} />
                <Route
                  path="/entities"
                  element={<ViewerPage theme={theme} onToggleTheme={toggleTheme} />}
                />
                <Route
                  path="/viewer"
                  element={<ViewerPage theme={theme} onToggleTheme={toggleTheme} />}
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
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
