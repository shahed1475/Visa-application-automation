import { NavLink, Outlet } from 'react-router-dom';

export function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1>Visa Autofill</h1>
        <nav>
          <NavLink to="/settings/portals">Visa Portals</NavLink>
          <NavLink to="/applicants">Applicants</NavLink>
        </nav>
      </header>
      <main className="app__main">
        <Outlet />
      </main>
    </div>
  );
}
