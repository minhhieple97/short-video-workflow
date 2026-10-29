import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type IconButtonProps = Omit<ComponentProps<typeof Button>, "aria-label" | "title"> & {
  // The action's name: the tooltip text and the accessible name, since the button itself shows only an icon.
  label: string;
  // Why the button is unavailable, or anything else worth a second line; read out with the label.
  note?: string;
};

export function IconButton({ label, note, size = "icon", disabled, ...props }: Readonly<IconButtonProps>) {
  const button = <Button size={size} disabled={disabled} aria-label={note ? `${label} — ${note}` : label} {...props} />;
  return (
    // Not hoverable: its grace area would span the neighbouring icon button, which would keep showing this label.
    <Tooltip disableHoverableContent>
      {/* A disabled button gets no pointer events, so its wrapper carries the tooltip. */}
      <TooltipTrigger asChild>{disabled ? <span className="inline-flex">{button}</span> : button}</TooltipTrigger>
      <TooltipContent>
        {label}
        {note ? <span className="block font-normal opacity-80">{note}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}
