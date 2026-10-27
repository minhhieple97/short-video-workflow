import { COLORS, FONT_FAMILY, SAFE_BOX } from "../theme/tokens";

export function BookBadge({ title }: Readonly<{ title: string }>) {
  return (
    <div
      style={{
        position: "absolute",
        top: SAFE_BOX.top - 72,
        left: SAFE_BOX.left,
        right: SAFE_BOX.right,
        fontFamily: FONT_FAMILY,
        fontSize: 30,
        fontWeight: 500,
        color: COLORS.muted,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      Từ sách: {title}
    </div>
  );
}
