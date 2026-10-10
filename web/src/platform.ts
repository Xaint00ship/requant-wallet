import type { ReactNode } from "react";
export type UpdateProps = {
  blocked: boolean;
  locked: boolean;
  clear: () => void;
  installing: (value: boolean) => void;
  details: boolean;
};
export type Platform = {
  kind: "native" | "extension";
  load: () => Promise<{ revision: number; data: Record<string, string> }>;
  save: (revision: number, key: string, value: string) => Promise<number>;
  core?: (op: string, args: Record<string, unknown>) => Promise<any>;
  rpc?: (method: string, params: unknown[]) => Promise<string>;
  lock: () => void;
  download: (text: string, name: string) => Promise<boolean>;
  pick?: (max: number) => Promise<{ text: string; name: string } | null>;
  copy?: (text: string) => Promise<void>;
  share?: (address: string) => Promise<void>;
  fileDialogOpen?: () => boolean;
  updates: (props: UpdateProps) => ReactNode;
  settings?: () => Promise<{ endpoint: string; autoLockMinutes: number }>;
  configure?: (endpoint: string) => Promise<void>;
};
declare global {
  interface Window {
    __REQUANT_PLATFORM__?: Platform;
  }
}
export const platform = () => window.__REQUANT_PLATFORM__;
export const site = (path: string) => `https://requant.network${path}`;
