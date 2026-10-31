"use client";

import { Minus, Plus, Trash2 } from "lucide-react";

import { IconButton } from "@/components/layout/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { truncateText } from "@/lib/format";

import {
  CHARACTER_ACTION_LABELS,
  CHARACTER_ACTIONS,
  ILLUSTRATION_SETTING_LABELS,
  ILLUSTRATION_SETTINGS,
} from "../domain/illustration";
import { PROP_IDS, PROP_LABELS, type PropId } from "../domain/props";
import { SHOT_SIZE_LABELS, SHOT_SIZES } from "../domain/scene-shots";
import {
  CARD_LIMITS,
  CARD_STYLE_LABELS,
  CARD_STYLES,
  cardProblem,
  MAX_SHOT_PROPS,
  PARTNER_ACTION_LABELS,
  PARTNER_ACTIONS,
  PROP_LABEL_MAX,
  SHOT_MOOD_LABELS,
  SHOT_MOODS,
  SHOT_TAG_MAX,
  type CardStyle,
  type PlannedShot,
} from "../domain/shot-plan";

const NONE = "__none";
const STAGE = "__stage";

function Choice<T extends string>({
  id,
  label,
  value,
  options,
  labels,
  none,
  onChange,
  disabled,
}: Readonly<{
  id: string;
  label: string;
  value: T | undefined;
  options: readonly T[];
  labels: Record<T, string>;
  // The wording of "not set" (kept from the shot before, or left to the renderer).
  none: string;
  onChange: (next: T | undefined) => void;
  disabled: boolean;
}>) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <Select
        value={value ?? NONE}
        onValueChange={(next) => onChange(options.find((option) => option === next))}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{none}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {labels[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// One shot of a scene: the word it starts on, then either the cartoon (only what changes) or a full-screen text card.
export function ShotRow({
  id,
  index,
  shot,
  words,
  firstWord,
  lastWord,
  onChange,
  onRemove,
  disabled,
}: Readonly<{
  id: string;
  index: number;
  shot: PlannedShot;
  words: readonly string[];
  // The words this shot may start on, between its neighbours.
  firstWord: number;
  lastWord: number;
  onChange: (next: PlannedShot) => void;
  onRemove: () => void;
  disabled: boolean;
}>) {
  // A field set back to undefined is left out when the plan is saved.
  const set = (patch: Partial<PlannedShot>) => onChange({ ...shot, ...patch });
  const props = shot.props ?? [];
  const setProp = (slot: number, id: PropId | undefined, label?: string) => {
    const next = [...props];
    if (id) next[slot] = label ? { id, label } : { id };
    else next.splice(slot, 1);
    set({ props: next.length > 0 ? next : undefined });
  };
  const card = shot.card;
  const lines = card?.lines ?? [];
  const problem = card ? cardProblem(card) : null;
  const propSlots = card ? 1 : Math.min(MAX_SHOT_PROPS, props.length + 1);
  const choices = Array.from({ length: Math.max(0, lastWord - firstWord + 1) }, (_, offset) => firstWord + offset);

  return (
    <li className="border-border flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <span className="text-sm font-semibold">Shot {index + 1}</span>
        {index === 0 ? (
          <span className="text-muted-foreground text-xs">bắt đầu cùng lời dẫn</span>
        ) : (
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor={`${id}-from`} className="text-muted-foreground text-xs">
              Bắt đầu từ chữ
            </Label>
            <Select
              value={String(shot.fromWord)}
              onValueChange={(value) => set({ fromWord: Number(value) })}
              disabled={disabled}
            >
              <SelectTrigger id={`${id}-from`} className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choices.map((word) => (
                  <SelectItem key={word} value={String(word)}>
                    {truncateText(`${word + 1}. ${words.slice(word, word + 4).join(" ")}`, 36)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-kind`} className="text-muted-foreground text-xs">
            Hình
          </Label>
          <Select
            value={card?.style ?? STAGE}
            onValueChange={(value) => {
              const style = CARD_STYLES.find((candidate) => candidate === value);
              set({ card: style ? { style, lines: lines.length > 0 ? lines : [""] } : undefined });
            }}
            disabled={disabled}
          >
            <SelectTrigger id={`${id}-kind`} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STAGE}>Hoạt cảnh</SelectItem>
              {CARD_STYLES.map((style) => (
                <SelectItem key={style} value={style}>
                  Thẻ chữ: {CARD_STYLE_LABELS[style]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {index > 0 ? (
          <IconButton
            label="Xoá shot"
            size="icon-sm"
            variant="ghost"
            className="ml-auto"
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 aria-hidden />
          </IconButton>
        ) : null}
      </div>

      {card ? (
        <CardLines
          id={id}
          style={card.style}
          lines={lines}
          problem={problem}
          disabled={disabled}
          onChange={(next) => set({ card: { style: card.style, lines: next } })}
        />
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Choice
            id={`${id}-setting`}
            label="Bối cảnh"
            value={shot.setting}
            options={ILLUSTRATION_SETTINGS}
            labels={ILLUSTRATION_SETTING_LABELS}
            none="Như shot trước"
            onChange={(setting) => set({ setting })}
            disabled={disabled}
          />
          <Choice
            id={`${id}-action`}
            label="Nhân vật đang"
            value={shot.action}
            options={CHARACTER_ACTIONS}
            labels={CHARACTER_ACTION_LABELS}
            none="Như shot trước"
            onChange={(action) => set({ action })}
            disabled={disabled}
          />
          <Choice
            id={`${id}-mood`}
            label="Cảm xúc"
            value={shot.mood}
            options={SHOT_MOODS}
            labels={SHOT_MOOD_LABELS}
            none="Theo hành động"
            onChange={(mood) => set({ mood })}
            disabled={disabled}
          />
          <Choice
            id={`${id}-partner`}
            label="Nhân vật phụ"
            value={shot.partner}
            options={PARTNER_ACTIONS}
            labels={PARTNER_ACTION_LABELS}
            none="Không có"
            onChange={(partner) => set({ partner })}
            disabled={disabled}
          />
          <Choice
            id={`${id}-size`}
            label="Khung hình"
            value={shot.size}
            options={SHOT_SIZES}
            labels={SHOT_SIZE_LABELS}
            none="Tự động"
            onChange={(size) => set({ size })}
            disabled={disabled}
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-tag`} className="text-muted-foreground text-xs">
              Nhãn trên hình
            </Label>
            <Input
              id={`${id}-tag`}
              className="w-40"
              value={shot.tag ?? ""}
              maxLength={SHOT_TAG_MAX}
              placeholder="Ví dụ: Ngày thứ 3"
              disabled={disabled}
              onChange={(event) => set({ tag: event.target.value.trim() ? event.target.value : undefined })}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        {Array.from({ length: propSlots }, (_, slot) => (
          <div key={slot} className="flex items-end gap-1">
            <Choice
              id={`${id}-prop-${slot}`}
              label={card ? "Biểu tượng" : `Đồ vật ${slot + 1}`}
              value={props[slot]?.id}
              options={PROP_IDS}
              labels={PROP_LABELS}
              none="Không có"
              onChange={(prop) => setProp(slot, prop, props[slot]?.label)}
              disabled={disabled}
            />
            {props[slot] && !card ? (
              <Input
                aria-label={`Chữ dưới đồ vật ${slot + 1}`}
                className="w-32"
                value={props[slot]?.label ?? ""}
                maxLength={PROP_LABEL_MAX}
                placeholder="Chữ kèm"
                disabled={disabled}
                onChange={(event) =>
                  setProp(slot, props[slot]?.id, event.target.value.trim() ? event.target.value : undefined)
                }
              />
            ) : null}
          </div>
        ))}
      </div>
    </li>
  );
}

function CardLines({
  id,
  style,
  lines,
  problem,
  disabled,
  onChange,
}: Readonly<{
  id: string;
  style: CardStyle;
  lines: readonly string[];
  problem: string | null;
  disabled: boolean;
  onChange: (next: string[]) => void;
}>) {
  const limits = CARD_LIMITS[style];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">
        {style === "NUMBER"
          ? "Dòng 1: con số ngắn; dòng 2: chú thích"
          : style === "VERSUS"
            ? "Dòng 1: cách sai; dòng 2: cách đúng"
            : style === "QUOTE"
              ? "Một câu nguyên văn từ sách"
              : `${limits.minLines}–${limits.maxLines} dòng`}
      </span>
      {lines.map((line, index) => (
        <div key={index} className="flex items-center gap-1">
          <Input
            aria-label={`Dòng ${index + 1}`}
            id={index === 0 ? `${id}-line` : undefined}
            value={line}
            maxLength={limits.lineChars}
            disabled={disabled}
            onChange={(event) => onChange(lines.map((each, at) => (at === index ? event.target.value : each)))}
          />
          {lines.length > 1 ? (
            <IconButton
              label="Bỏ dòng này"
              size="icon-sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange(lines.filter((_, at) => at !== index))}
            >
              <Minus aria-hidden />
            </IconButton>
          ) : null}
        </div>
      ))}
      {lines.length < limits.maxLines ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="self-start"
          disabled={disabled}
          onClick={() => onChange([...lines, ""])}
        >
          <Plus aria-hidden /> Thêm dòng
        </Button>
      ) : null}
      {problem ? <p className="text-xs text-red-600 dark:text-red-400">{problem}</p> : null}
    </div>
  );
}
