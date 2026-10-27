export interface SystemStatusDto {
  worker: "running" | "stopped";
  activeJobs: number;
  aiMode: "mock" | "cli-task" | "cli-auto";
}
