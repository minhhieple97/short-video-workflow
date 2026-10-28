// What the UI may know about the Drive connection. Tokens, the client secret and the account ID never appear here.
export interface DriveConnectionDto {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  connectedAt: string | null;
}

export interface DriveAuthorizationDto {
  authorizationUrl: string;
}
