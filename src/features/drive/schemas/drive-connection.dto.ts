// What the UI may know about the Drive connection. Tokens, the client secret and the account ID never appear here.
export interface DriveConnectionDto {
  configured: boolean;
  connected: boolean;
  // Google stopped accepting the stored permission; the user has to sign in again.
  needsReconnect: boolean;
  accountEmail: string | null;
  connectedAt: string | null;
}

export interface DriveAuthorizationDto {
  authorizationUrl: string;
}

export interface DriveDisconnectDto extends DriveConnectionDto {
  // False when Google could not be reached: the app forgot the permission, but the user may also remove it in their
  // Google account.
  revokedAtGoogle: boolean;
}

export interface DriveOverviewDto {
  connection: DriveConnectionDto;
  // This app's own use over the last 24 hours, judged against its own limits (not Google's project quota).
  usage: { requests: number; maxRequests: number; bytesSent: number; maxBytes: number };
  capacity: DriveStorageDto | null;
  failedArchives: number;
}

export interface DriveStorageDto {
  limitBytes: number | null;
  usageBytes: number;
  usageInDriveBytes: number | null;
  usageInDriveTrashBytes: number | null;
  fetchedAt: string;
}
