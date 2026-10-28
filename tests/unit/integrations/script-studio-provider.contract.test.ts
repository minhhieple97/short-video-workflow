import { describeScriptStudioProviderContract } from "../../helpers/contracts/script-studio-provider-contract";
import { FakeScriptStudioProvider } from "../../helpers/fakes/fake-script-studio-provider";

describeScriptStudioProviderContract("FakeScriptStudioProvider", () => new FakeScriptStudioProvider());
