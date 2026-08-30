export type IntegrationStatus = "connected" | "expired" | "revoked";

export interface Integration {
  id: string;
  provider: string;
  accountEmail: string | null;
  status: IntegrationStatus | string;
  connectedAt: number;
  updatedAt: number;
}

export interface AvailableProvider {
  id: string;
  label: string;
  description: string;
  scopes: string[];
}
