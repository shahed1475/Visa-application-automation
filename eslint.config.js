import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/', 'data/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/web/**/*.{ts,tsx}', 'test/web/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Narrowed from `test/**` once the applicant schemas started exporting their
    // `z.input` shapes: every section / travel / reference / field-meta fixture is
    // now assignable without a cast, so the service and route tests carry no `any`.
    // This one file still needs it — it calls the pure completeness/verification
    // helpers with deliberately partial `ApplicantDetail` slices (`{} as any`,
    // `[] as any[]`) that no exported type describes.
    files: ['test/server/applicantCompleteness.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // The Phase 5 field-mapper spec is checked in verbatim (see task-2-brief.md):
    // it builds deliberately partial `FieldPlan` / `SectionPlan` fixtures with
    // `{ ... } as any` and probes `m.fieldPath === null as any`. No exported type
    // describes those partial slices; the test body must not be restructured.
    files: ['test/automation/fieldMapping.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // The Phase 6 migration-6 spec is checked in verbatim (see
    // .superpowers/sdd/2026-09-06-phase-6-india-portal-adapter/task-2-brief.md): it reads
    // untyped PRAGMA / count rows as `(... as any).user_version` etc. The test body must
    // not be restructured away from the brief.
    files: ['test/automation/discoveryMigrations.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
