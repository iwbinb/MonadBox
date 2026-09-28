import React, { Component, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from './context';
import { Layout } from './components';
import {
  HomePage,
  ToolPage,
  DashboardPage,
  RefundsPage,
  StatusPage,
  UnavailablePage,
  NotFoundPage,
} from './pages';
import './styles.css';
const GroupActivityPage = lazy(() =>
  import('./group/GroupFunds').then((m) => ({ default: m.GroupActivityPage })),
);
const LabPage = lazy(() => import('./lab/LabPage'));
const GroupBuilderPage = lazy(() =>
  import('./group/GroupPages').then((m) => ({ default: m.GroupBuilderPage })),
);
const GroupDraftPage = lazy(() =>
  import('./group/GroupPages').then((m) => ({ default: m.GroupDraftPage })),
);
const GroupDraftListPage = lazy(() =>
  import('./group/GroupPages').then((m) => ({ default: m.GroupDraftListPage })),
);
const CloudGroupsPage = lazy(() =>
  import('./cloud/CloudPages').then((m) => ({ default: m.CloudGroupsPage })),
);
const CloudGroupPage = lazy(() =>
  import('./cloud/CloudPages').then((m) => ({ default: m.CloudGroupPage })),
);
const PublicGroupPage = lazy(() =>
  import('./cloud/CloudPages').then((m) => ({ default: m.PublicGroupPage })),
);
function groupSurface(children: ReactNode) {
  return (
    <Suspense fallback={<p className="container">Loading drafts / 加载草稿…</p>}>
      {children}
    </Suspense>
  );
}
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    console.error('MonadBox UI could not render. Payment actions remain disabled.');
  }
  render() {
    if (this.state.failed)
      return (
        <main className="container not-found">
          <h1>Unable to load MonadBox / 页面暂不可用</h1>
          <p>Payments remain disabled. 付款功能保持关闭。</p>
          <a href="/">Reload / 重新加载</a>
        </main>
      );
    return this.props.children;
  }
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="tools/:id" element={<ToolPage />} />
              <Route path="app" element={<DashboardPage />} />
              <Route path="help/refunds" element={<RefundsPage />} />
              <Route path="status" element={<StatusPage />} />
              <Route
                path="lab"
                element={
                  <Suspense fallback={<p className="container">Loading lab / 加载实验室…</p>}>
                    <LabPage />
                  </Suspense>
                }
              />
              <Route path="create/group" element={groupSurface(<GroupBuilderPage />)} />
              <Route path="app/group-drafts" element={groupSurface(<GroupDraftListPage />)} />
              <Route path="app/group-drafts/:draftId" element={groupSurface(<GroupDraftPage />)} />
              <Route
                path="app/group-drafts/:draftId/edit"
                element={groupSurface(<GroupBuilderPage />)}
              />
              <Route path="create/:id" element={<UnavailablePage />} />
              <Route path="app/group-activity" element={groupSurface(<GroupActivityPage />)} />
              <Route path="app/groups" element={groupSurface(<CloudGroupsPage />)} />
              <Route path="app/groups/:id" element={groupSurface(<CloudGroupPage />)} />
              <Route path="b/:id" element={groupSurface(<PublicGroupPage />)} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
