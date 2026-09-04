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
);
