export type PortalType = 'regular' | 'evisa' | 'custom';

export interface VisaPortal {
  id: string;
  name: string;
  url: string;
  portalType: PortalType;
  country: string | null;
  applicationType: string | null;
  notes: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionTestResult {
  success: boolean;
  url: string;
  httpStatus: number | null;
  pageTitle: string | null;
  finalUrl: string | null;
  redirected: boolean;
  redirectChain: string[];
  elementCounts: Record<string, number>;
  securityChallengeFlags: Record<string, boolean>;
  screenshotPath: string | null;
  durationMs: number;
  error?: { code: string; message: string };
}

export interface ApiError {
  error: { code: string; message: string };
}
