"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CHARACTER_PRESET_IDS,
  CHARACTER_PRESETS,
  type CharacterSettings,
  type CharacterProfile,
} from "@/features/videos/domain/characters";
import { PeepFigure } from "@/remotion/peeps/peep";

export function CharacterSettingsCard({
  value,
  onChange,
}: Readonly<{ value: CharacterSettings; onChange: (next: CharacterSettings) => void }>) {
  function update(id: string, patch: Partial<CharacterProfile>): void {
    onChange({
      ...value,
      profiles: value.profiles.map((profile) => (profile.id === id ? { ...profile, ...patch } : profile)),
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nhân vật xuyên suốt</CardTitle>
        <CardDescription>
          Opus tự chọn ít người nhất đủ kể chuyện. Tên và ngoại hình được giữ cố định trong mỗi video; mỗi shot tối đa
          hai người.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="primary-character">Nhân vật chính mặc định</Label>
            <select
              id="primary-character"
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              value={value.primaryCharacterId}
              onChange={(event) => onChange({ ...value, primaryCharacterId: event.target.value })}
            >
              {value.profiles.map((profile) => (
                <option key={profile.id} value={profile.id} disabled={!profile.enabled}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-characters">Số nhân vật tối đa trong câu chuyện</Label>
            <Input
              id="max-characters"
              type="number"
              min={1}
              max={value.profiles.filter((profile) => profile.enabled).length}
              value={value.maxCharacters}
              onChange={(event) => onChange({ ...value, maxCharacters: Number(event.target.value) })}
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {value.profiles.map((profile) => (
            <div key={profile.id} className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <svg
                  viewBox="100 -100 1100 1500"
                  role="img"
                  aria-label={`Tạo hình ${profile.name}`}
                  className="h-28 w-24 shrink-0"
                >
                  <PeepFigure body="Shirt" face="Calm" look={CHARACTER_PRESETS[profile.presetId].look} />
                </svg>
                <Label className="flex items-center gap-2" htmlFor={`character-enabled-${profile.id}`}>
                  <Checkbox
                    id={`character-enabled-${profile.id}`}
                    checked={profile.enabled}
                    onCheckedChange={(checked) => update(profile.id, { enabled: checked === true })}
                  />
                  Sử dụng
                </Label>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`character-name-${profile.id}`}>Tên</Label>
                <Input
                  id={`character-name-${profile.id}`}
                  maxLength={40}
                  value={profile.name}
                  onChange={(event) => update(profile.id, { name: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`character-pronoun-${profile.id}`}>Cách xưng hô</Label>
                <Input
                  id={`character-pronoun-${profile.id}`}
                  maxLength={20}
                  value={profile.pronoun}
                  onChange={(event) => update(profile.id, { pronoun: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`character-preset-${profile.id}`}>Tạo hình</Label>
                <select
                  id={`character-preset-${profile.id}`}
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  value={profile.presetId}
                  onChange={(event) => {
                    const presetId = CHARACTER_PRESET_IDS.find((id) => id === event.target.value);
                    if (presetId) update(profile.id, { presetId });
                  }}
                >
                  {CHARACTER_PRESET_IDS.map((id) => (
                    <option key={id} value={id}>
                      {CHARACTER_PRESETS[id].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
