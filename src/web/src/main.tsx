import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { App } from './App';
import { PortalsPage } from './pages/Settings/PortalsPage';
import { ApplicantsPage } from './pages/Applicants/ApplicantsPage';
import { ApplicantDetailPage } from './pages/Applicants/ApplicantDetailPage';
import { ApplicationDashboardPage } from './pages/Applications/ApplicationDashboardPage';
import { AutomationRunPage } from './pages/Automation/AutomationRunPage';
import { VisaRulesPage } from './pages/VisaRules/VisaRulesPage';
import { DocumentsPage } from './pages/Documents/DocumentsPage';
import { DocumentDetailPage } from './pages/Documents/DocumentDetailPage';
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
      { path: 'applications/:id', element: <ApplicationDashboardPage /> },
      { path: 'automation-runs/:id', element: <AutomationRunPage /> },
      { path: 'documents', element: <DocumentsPage /> },
      { path: 'documents/:id', element: <DocumentDetailPage /> },
      { path: 'visa-rules', element: <VisaRulesPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
