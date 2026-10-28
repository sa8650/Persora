export interface ConnectionRegistryEntry {
  id: string;
  name: string;
  vendor: string;
  category: string;
  description: string;
  available: boolean;
  capabilities: string[];
}

export declare const CONNECTION_PROVIDERS: readonly ConnectionRegistryEntry[];
