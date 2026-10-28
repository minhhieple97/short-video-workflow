import { afterAll, beforeAll } from "vitest";

import { GoogleDriveArchiveProvider } from "@/server/archive/google-drive/drive-archive-provider";
import { GoogleDriveClient } from "@/server/archive/google-drive/google-drive-client";

import { describeVideoArchiveProviderContract } from "../../helpers/contracts/video-archive-provider-contract";
import { FakeGoogleServer } from "../../helpers/fake-google-server";
import { InMemoryArchiveFolderStore } from "../../helpers/fakes/in-memory-archive-folder-store";

const google = new FakeGoogleServer();

beforeAll(async () => {
  await google.start();
});

afterAll(async () => {
  await google.stop();
});

describeVideoArchiveProviderContract("GoogleDriveArchiveProvider (fake Google)", () => {
  google.objects.clear();
  google.uploadSessions.clear();
  const provider = new GoogleDriveArchiveProvider({
    drive: new GoogleDriveClient({ getAccessToken: async () => "ya29.token", endpoints: google.endpoints }),
    folders: new InMemoryArchiveFolderStore(),
  });
  return {
    provider,
    remoteObjectCount: () =>
      [...google.objects.values()].filter((object) => object.mimeType !== "application/vnd.google-apps.folder").length,
  };
});
