import { describeScenePlanCompilerContract } from "../../helpers/contracts/scene-plan-compiler-contract";
import { MockScenePlanCompiler } from "@/server/scene-plan/mock-scene-plan-compiler";

describeScenePlanCompilerContract("MockScenePlanCompiler", () => new MockScenePlanCompiler());
