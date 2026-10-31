// The names the render page uses ("Render nháp", "Render bản cuối"), so a message and the screen it points to agree.
export function renderVersionName(qualityPreset: "DRAFT" | "FINAL"): "Bản nháp" | "Bản cuối" {
  return qualityPreset === "FINAL" ? "Bản cuối" : "Bản nháp";
}

export function renderVersionLabel(render: {
  qualityPreset: "DRAFT" | "FINAL";
  width: number;
  height: number;
}): string {
  return `${renderVersionName(render.qualityPreset)} · ${render.width}×${render.height}`;
}
