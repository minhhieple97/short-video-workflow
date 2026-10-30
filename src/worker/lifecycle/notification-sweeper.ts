import { dispatchNextNotification } from "@/features/notifications/services/notification-dispatch.service";
import { createLogger } from "@/shared/logger";

const logger = createLogger("worker.notifications");

export function startNotificationSweeper(): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  const sweep = () => {
    inFlight ??= dispatchNextNotification()
      .catch(() => logger.warn("Could not dispatch notifications; will retry on the next sweep"))
      .finally(() => {
        inFlight = null;
      });
  };
  sweep();
  const timer = setInterval(sweep, 5000);
  return async () => {
    clearInterval(timer);
    await inFlight;
  };
}
