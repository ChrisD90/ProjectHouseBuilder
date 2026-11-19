import { useEffect, useState } from 'react';
import { ActionIcon, Button, NumberInput, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { TileSettings } from './tile-layout';
export type RoomGeometry = Pick<TileSettings, 'width' | 'height' | 'contour' | 'roomShape'>;
export const roomGeometryOnly = (s: RoomGeometry): RoomGeometry => ({
  width: s.width,
  height: s.height,
  contour: s.contour?.map((p) => ({ ...p })),
  roomShape: s.roomShape,
});
// Keep intermediate input such as "3," while converting cm to internal mm.
export function Measurement({
  value,
  scale,
  label,
  max,
  disabled,
  onChange,
}: {
  value: number;
  scale: number;
  label: string;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [raw, setRaw] = useState<number | string>(Number.isFinite(value) ? value / scale : '');
  useEffect(() => {
    setRaw(Number.isFinite(value) ? value / scale : '');
  }, [value, scale]);
  return (
    <NumberInput
      label={label}
      value={raw}
      min={0}
      max={max}
      decimalScale={3}
      decimalSeparator=","
      hideControls
      disabled={disabled}
      onChange={(v) => {
        setRaw(v);
        onChange(v === '' ? NaN : Number(v) * scale);
      }}
    />
  );
}

export function RoomGeometryFields({
  value: s,
  onChange,
  busy = false,
  showPoints,
  setShowPoints,
}: {
  value: RoomGeometry;
  onChange: (value: RoomGeometry) => void;
  busy?: boolean;
  showPoints: boolean;
  setShowPoints: (value: boolean) => void;
}) {
  function chooseShape(shape: NonNullable<TileSettings['roomShape']>) {
    const w = s.width,
      h = s.height;
    const rectangle = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    const contour =
      shape === 'rectangle'
        ? undefined
        : shape === 'l'
          ? [
              { x: 0, y: 0 },
              { x: w, y: 0 },
              { x: w, y: h * 0.5 },
              { x: w * 0.5, y: h * 0.5 },
              { x: w * 0.5, y: h },
              { x: 0, y: h },
            ]
          : shape === 'trapezoid'
            ? [
                { x: w * 0.2, y: 0 },
                { x: w * 0.8, y: 0 },
                { x: w, y: h },
                { x: 0, y: h },
              ]
            : shape === 'round'
              ? Array.from({ length: 48 }, (_, i) => ({
                  x: w / 2 + (Math.cos((i * Math.PI) / 24) * w) / 2,
                  y: h / 2 + (Math.sin((i * Math.PI) / 24) * h) / 2,
                }))
              : s.contour || rectangle;
    onChange({ ...s, roomShape: shape, contour });
    setShowPoints(shape === 'custom');
  }
  function changeDimension(key: 'width' | 'height', value: number) {
    if ((key === 'width' || key === 'height') && s.contour && Number.isFinite(value) && value > 0) {
      const axis = key === 'width' ? 'x' : 'y';
      const previous =
        Number.isFinite(s[key]) && s[key] > 0 ? s[key] : Math.max(...s.contour.map((p) => p[axis]));
      onChange({
        ...s,
        [key]: value,
        contour: s.contour.map((p) => ({
          ...p,
          [axis]: Math.min(value, Math.max(0, (p[axis] * value) / previous)),
        })),
      });
    } else onChange({ ...s, [key]: value });
  }
  return (
    <Stack gap="xs">
      <Select
        label="Raumform"
        value={s.roomShape || (s.contour ? 'custom' : 'rectangle')}
        allowDeselect={false}
        data={[
          { value: 'rectangle', label: 'Rechteck' },
          { value: 'l', label: 'L-Form' },
          { value: 'trapezoid', label: 'Schräge Wände' },
          { value: 'round', label: 'Rund / oval (angenähert)' },
          { value: 'custom', label: 'Freie Kontur' },
        ]}
        onChange={(v) => {
          if (v) chooseShape(v as NonNullable<TileSettings['roomShape']>);
        }}
      />
      <SimpleGrid cols={2}>
        <Measurement
          label="Breite (cm)"
          value={s.width}
          scale={10}
          max={10000}
          disabled={busy}
          onChange={(v) => changeDimension('width', v)}
        />
        <Measurement
          label="Tiefe (cm)"
          value={s.height}
          scale={10}
          max={10000}
          disabled={busy}
          onChange={(v) => changeDimension('height', v)}
        />
      </SimpleGrid>
      {s.contour && (
        <>
          <Text size="xs" c="dimmed">
            Außenmaße skalieren die Kontur. Eckpunkte der Reihe nach um den Raum herum eingeben; X
            nach rechts, Y nach unten. Der letzte Punkt wird automatisch mit dem ersten verbunden.
          </Text>
          <Button variant="subtle" size="compact-sm" onClick={() => setShowPoints(!showPoints)}>
            {showPoints ? 'Eckpunkte ausblenden' : 'Eckpunkte bearbeiten'} ({s.contour.length})
          </Button>
          {showPoints && (
            <div className="tile-point-list">
              {s.contour.map((p, i) => (
                <div className="tile-point-row" key={i}>
                  <Text size="xs" fw={600}>
                    {i + 1}
                  </Text>
                  {(['x', 'y'] as const).map((axis) => (
                    <Measurement
                      key={axis}
                      label={`${axis.toUpperCase()} (cm)`}
                      value={p[axis]}
                      scale={10}
                      max={10000}
                      disabled={busy}
                      onChange={(v) =>
                        onChange({
                          ...s,
                          roomShape: 'custom',
                          contour: s.contour!.map((q, j) => (i === j ? { ...q, [axis]: v } : q)),
                        })
                      }
                    />
                  ))}
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Eckpunkt ${i + 1} löschen`}
                    disabled={s.contour!.length <= 3 || busy}
                    onClick={() =>
                      onChange({
                        ...s,
                        roomShape: 'custom',
                        contour: s.contour!.filter((_, j) => i !== j),
                      })
                    }
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    aria-label={`Eckpunkt nach Punkt ${i + 1} einfügen`}
                    disabled={s.contour!.length >= 64 || busy}
                    onClick={() => {
                      const next = s.contour![(i + 1) % s.contour!.length];
                      const points = [...s.contour!];
                      points.splice(i + 1, 0, {
                        x: (p.x + next.x) / 2,
                        y: (p.y + next.y) / 2,
                      });
                      onChange({
                        ...s,
                        roomShape: 'custom',
                        contour: points,
                      });
                    }}
                  >
                    <IconPlus size={14} />
                  </ActionIcon>
                </div>
              ))}
              <Button
                variant="default"
                size="xs"
                disabled={s.contour.length >= 64 || busy}
                onClick={() => {
                  const a = s.contour!.at(-1)!,
                    b = s.contour![0];
                  onChange({
                    ...s,
                    roomShape: 'custom',
                    contour: [...s.contour!, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }],
                  });
                }}
              >
                Eckpunkt hinzufügen
              </Button>
            </div>
          )}
        </>
      )}
    </Stack>
  );
}
