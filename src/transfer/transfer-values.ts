export const ExportState = { IDLE: 'idle', RUNNING: 'running', READY: 'ready', FAILED: 'failed' } as const;
export const TransferError = { AUTH: 'auth', NOT_EMPTY: 'notEmpty', INVALID: 'invalid', UNAVAILABLE: 'unavailable' } as const;

export type TransferStatus =
    | {
          error: (typeof TransferError)[keyof typeof TransferError];
      }
    | {
          state: string;
          expiresAt: string | null;
          downloadable: boolean;
          canImport: boolean;
          importedAt: string | null;
          importError: string | null;
      };
