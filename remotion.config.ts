import { Config } from "@remotion/cli/config";

import { withAppAlias } from "./src/server/render/webpack-override";

Config.overrideWebpackConfig(withAppAlias);
