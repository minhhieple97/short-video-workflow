import { describeVideoArchiveProviderContract } from "../../helpers/contracts/video-archive-provider-contract";
import { FakeVideoArchiveProvider } from "../../helpers/fakes/fake-video-archive-provider";

describeVideoArchiveProviderContract("FakeVideoArchiveProvider", () => {
  const provider = new FakeVideoArchiveProvider();
  return { provider, remoteObjectCount: () => provider.remoteObjectCount };
});
