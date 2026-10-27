import {
  CONTENT_SAFE_AREA,
  PLATFORM_LABELS,
  SAFE_ZONE_DEFAULTS,
  type PlatformPreviewMode,
} from "../../domain/safe-zones";

// Editor-only guide drawn over the Player; it is never part of the composition, so it never reaches the MP4.
export function SafeZoneOverlay({ mode }: Readonly<{ mode: PlatformPreviewMode }>) {
  const zone = SAFE_ZONE_DEFAULTS[mode];
  const shade = "rgba(220, 38, 38, 0.18)";
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="absolute inset-x-0 top-0" style={{ height: `${zone.top}%`, background: shade }} />
      <div className="absolute inset-x-0 bottom-0" style={{ height: `${zone.bottom}%`, background: shade }} />
      <div
        className="absolute right-0"
        style={{ top: `${zone.top}%`, bottom: `${zone.bottom}%`, width: `${zone.right}%`, background: shade }}
      />
      <div
        className="absolute border-2 border-dashed border-emerald-500/80"
        style={{
          top: `${CONTENT_SAFE_AREA.top}%`,
          bottom: `${CONTENT_SAFE_AREA.bottom}%`,
          left: `${CONTENT_SAFE_AREA.left}%`,
          right: `${CONTENT_SAFE_AREA.right}%`,
        }}
      />
      <span className="absolute bottom-1 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
        Vùng UI {PLATFORM_LABELS[mode]} (ước lượng)
      </span>
    </div>
  );
}
