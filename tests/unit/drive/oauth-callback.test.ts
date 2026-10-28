import { describe, expect, it } from "vitest";

import { oauthCallbackLocation } from "@/features/drive/domain/oauth-callback";

describe("oauthCallbackLocation", () => {
  it("forwards Google's answer from the app's root to the callback route", () => {
    expect(oauthCallbackLocation({ state: "s", code: "4/c", scope: "x y", other: "dropped" })).toBe(
      "/api/integrations/drive/callback?state=s&code=4%2Fc&scope=x+y",
    );
    expect(oauthCallbackLocation({ state: "s", error: "access_denied" })).toBe(
      "/api/integrations/drive/callback?state=s&error=access_denied",
    );
  });

  it("leaves an ordinary visit alone", () => {
    expect(oauthCallbackLocation({})).toBeNull();
    expect(oauthCallbackLocation({ state: "s" })).toBeNull();
    expect(oauthCallbackLocation({ code: "c" })).toBeNull();
    expect(oauthCallbackLocation({ state: ["a", "b"], code: "c" })).toBeNull();
  });
});
