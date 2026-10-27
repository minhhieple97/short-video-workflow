import type { CheckResult } from "../types";

const MINIMUM_NODE_MAJOR = 24;

export function checkNodeRuntime(): CheckResult {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  return {
    id: "node",
    label: "Node.js",
    status: major >= MINIMUM_NODE_MAJOR ? "ok" : "warn",
    summary:
      major >= MINIMUM_NODE_MAJOR
        ? `Node ${process.version}`
        : `Cần Node ≥ ${MINIMUM_NODE_MAJOR}, đang dùng ${process.version}`,
    details: { "Nền tảng": process.platform, "Kiến trúc": process.arch },
  };
}
