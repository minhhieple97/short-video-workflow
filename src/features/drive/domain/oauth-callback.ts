export const DRIVE_CALLBACK_PATH = "/api/integrations/drive/callback";

const FORWARDED_PARAMS = ["state", "code", "error", "scope"] as const;

// Google sends the browser back to the app's root (the documented loopback redirect has no path). A state together
// with a code or an error marks that return; anything else is an ordinary visit to the dashboard.
export function oauthCallbackLocation(searchParams: Record<string, string | string[] | undefined>): string | null {
  const isReturn =
    typeof searchParams.state === "string" &&
    (typeof searchParams.code === "string" || typeof searchParams.error === "string");
  if (!isReturn) return null;

  const query = new URLSearchParams();
  for (const name of FORWARDED_PARAMS) {
    const value = searchParams[name];
    if (typeof value === "string") query.set(name, value);
  }
  return `${DRIVE_CALLBACK_PATH}?${query.toString()}`;
}
