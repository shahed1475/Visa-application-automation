import type { TravelRecord } from '../../../../shared/applicant/types';

export function TravelSection(_props: {
  applicantId: string;
  records: TravelRecord[];
  onChange: () => void | Promise<void>;
}) {
  return (
    <section>
      <h3>Travel Records</h3>
    </section>
  );
}
