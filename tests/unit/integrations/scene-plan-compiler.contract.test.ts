import { describeScenePlanCompilerContract } from "../../helpers/contracts/scene-plan-compiler-contract";
import { FakeScenePlanCompiler } from "../../helpers/fakes/fake-scene-plan-compiler";

describeScenePlanCompilerContract("FakeScenePlanCompiler", () => new FakeScenePlanCompiler());
