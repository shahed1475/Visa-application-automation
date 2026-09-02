import type { Reference } from '../../../../shared/applicant/types';

export function ReferenceSection(_props: {
  applicantId: string;
  records: Reference[];
  onChange: () => void | Promise<void>;
}) {
  return (
    <section>
      <h3>References</h3>
    </section>
  );
}
