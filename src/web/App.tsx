import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { ImportPage } from './pages/ImportPage';
import { InventoryPage } from './pages/InventoryPage';
import { ListingDetailPage } from './pages/ListingDetailPage';
import { ListingEditorPage } from './pages/ListingEditorPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <InventoryPage /> },
      { path: '/new', element: <Navigate to="/listings/new/edit" replace /> },
      { path: '/listings/:id/edit', element: <ListingEditorPage /> },
      { path: '/listings/:id', element: <ListingDetailPage /> },
      { path: '/import', element: <ImportPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/logs', element: <LogsPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
