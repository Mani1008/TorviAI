export interface KnowledgeSource {
  id: string;
  targetKind: string;
  targetId: string;
  sourceType: string;
  refId: string;
  snippet: string;
}

export interface KnowledgeEntity {
  id: string;
  kind: string;
  title: string;
  body: string;
  status: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  lastConfirmedAt: number | null;
  sources: KnowledgeSource[];
}

export interface Skill {
  id: string;
  slug: string;
  title: string;
  yamlBody: string;
  status: string;
  version: number;
  entityId: string | null;
  createdAt: number;
  updatedAt: number;
  lastConfirmedAt: number | null;
  sources: KnowledgeSource[];
}

export interface SourceInput {
  sourceType: string;
  refId: string;
  snippet?: string;
}

export interface SaveEntityInput {
  kind: string;
  title: string;
  body: string;
  status?: string;
  sources?: SourceInput[];
}

export interface SaveSkillInput {
  slug: string;
  title: string;
  yamlBody: string;
  status?: string;
  entityId?: string | null;
  sources?: SourceInput[];
}

export interface GmailSyncStatus {
  provider: string;
  lastSyncAt: number | null;
  lastStatus: string;
  lastError: string | null;
  itemsSynced: number;
}

export interface GmailSyncResult {
  synced: number;
  skipped: number;
  status: GmailSyncStatus;
}
