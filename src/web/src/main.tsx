import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { App } from './App';
import { PortalsPage } from './pages/Settings/PortalsPage';
import { ApplicantsPage } from './pages/Applicants/ApplicantsPage';
import { ApplicantDetailPage } from './pages/Applicants/ApplicantDetailPage';
import './styles.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/settings/portals" replace /> },
      { path: 'settings/portals', element: <PortalsPage /> },
      { path: 'applicants', element: <ApplicantsPage /> },
      { path: 'applicants/:id', element: <ApplicantDetailPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
