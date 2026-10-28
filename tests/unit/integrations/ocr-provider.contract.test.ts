import { describeOcrProviderContract } from "../../helpers/contracts/ocr-provider-contract";
import { FakeOcrProvider } from "../../helpers/fakes/fake-ocr-provider";

describeOcrProviderContract("FakeOcrProvider (batch)", () => {
  const provider = new FakeOcrProvider({ mode: "batch" });
  return { provider, settle: (operationRef) => provider.settle(operationRef) };
});

describeOcrProviderContract("FakeOcrProvider (immediate)", () => {
  const provider = new FakeOcrProvider({ mode: "immediate" });
  return { provider, settle: () => undefined };
});
