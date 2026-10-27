import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { job: { type: "string" } }, strict: true });

if (!values.job) {
  console.error("Cách dùng: pnpm ai:run --job <jobId>");
  process.exit(2);
}

console.error(
  `Chạy tác vụ AI qua Claude Code CLI (job ${values.job}) chưa được triển khai — dự kiến ở M5. Hiện chỉ dùng AI_MODE=mock.`,
);
process.exit(1);
