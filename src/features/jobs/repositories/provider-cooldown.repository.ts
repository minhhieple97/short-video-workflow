import { prisma } from "@/server/db/client";
import { randomUUID } from "node:crypto";
import { recordNotificationWithin } from "@/features/notifications/repositories/notification.repository";
import { formatNotificationTime } from "@/features/notifications/domain/notification-text";

export function findProviderCooldown(provider: string) {
  return prisma.providerCooldown.findUnique({ where: { provider } });
}

export function listProviderCooldowns(now = new Date()) {
  return prisma.providerCooldown.findMany({ where: { blockedUntil: { gt: now } }, orderBy: { provider: "asc" } });
}

export async function saveProviderCooldown(input: {
  provider: string;
  blockedUntil: Date;
  errorCode: string;
  message: string;
  kind?: "QUOTA" | "TRANSIENT";
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.providerCooldown.findUnique({ where: { provider: input.provider } });
    const quota = input.kind === "QUOTA" || existing?.kind === "QUOTA";
    const episodeId = quota ? (existing?.episodeId ?? randomUUID()) : null;
    const blockedUntil =
      existing && existing.blockedUntil > input.blockedUntil ? existing.blockedUntil : input.blockedUntil;
    const data = { ...input, blockedUntil, kind: quota ? "QUOTA" : "TRANSIENT", episodeId };
    await tx.providerCooldown.upsert({ where: { provider: input.provider }, create: data, update: data });
    if (input.kind === "QUOTA" && existing?.kind !== "QUOTA") {
      await recordNotificationWithin(tx, {
        eventKey: `quota-wait:${episodeId}`,
        kind: "PROVIDER_WAITING",
        title: "⏳ Đang chờ hạn mức",
        fields: [
          ["Provider", input.provider],
          ["Mã lỗi", input.errorCode],
          ["Lý do", input.message],
          ["Dự kiến thử lại", formatNotificationTime(blockedUntil)],
        ],
      });
    }
  });
}

export async function clearProviderCooldown(provider: string, episodeId?: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.providerCooldown.findUnique({ where: { provider } });
    if (!existing || (episodeId !== undefined && existing.episodeId !== episodeId)) return;
    await tx.providerCooldown.delete({ where: { provider } });
    if (existing.kind === "QUOTA" && existing.episodeId)
      await recordNotificationWithin(tx, {
        eventKey: `quota-resumed:${existing.episodeId}`,
        kind: "PROVIDER_RESUMED",
        title: "▶️ Đã tiếp tục xử lý sau khi chờ hạn mức",
        fields: [
          ["Provider", provider],
          ["Chi tiết", "Một lần gọi provider đã thành công."],
        ],
      });
  });
}
