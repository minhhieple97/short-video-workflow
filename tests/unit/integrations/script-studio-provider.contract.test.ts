import { describeScriptStudioProviderContract } from "../../helpers/contracts/script-studio-provider-contract";
import { MockScriptStudioProvider } from "@/server/script-studio/mock-script-studio-provider";

describeScriptStudioProviderContract("MockScriptStudioProvider", () => new MockScriptStudioProvider());
