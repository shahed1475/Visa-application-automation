import { useParams } from 'react-router-dom';

export function ApplicationDashboardPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <section>
      <p>Application {id} — dashboard coming in a later task.</p>
    </section>
  );
}
