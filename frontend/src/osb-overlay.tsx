import { useId } from 'react';
import { osbLayout } from './osb-layout';
import { svgPath } from './tile-geometry';
export function OsbOverlay({
  plan,
  width,
  height,
  rotated,
}: {
  plan: ReturnType<typeof osbLayout>;
  width: number;
  height: number;
  rotated: boolean;
}) {
  const id = 'osb-' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const margin = Math.max(width, height) * 0.065;
  return (
    <g pointerEvents="none">
      <defs>
        <clipPath id={id + 'clip'}>
          <path d={svgPath([plan.room])} />
        </clipPath>
        <marker
          id={id + 'arrow'}
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
        >
          <path d="M0,0L7,3.5L0,7Z" fill="#245b78" />
        </marker>
      </defs>
      <g clipPath={'url(#' + id + 'clip)'}>
        {plan.osb.beams.map((line, index) => (
          <g key={index}>
            <line
              x1={line.a.x}
              y1={line.a.y}
              x2={line.b.x}
              y2={line.b.y}
              stroke="#536a79"
              strokeWidth={plan.osb.joistWidth}
              opacity=".2"
            />
            <line
              x1={line.a.x}
              y1={line.a.y}
              x2={line.b.x}
              y2={line.b.y}
              stroke="#536a79"
              strokeDasharray="5 4"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        {plan.osb.gaps.map((gap, index) => (
          <rect
            key={index}
            x={gap.x}
            y={gap.y}
            width={gap.width}
            height={gap.height}
            fill="#fff6e3"
            stroke="#a16c26"
            strokeWidth=".8"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {plan.osb.unsupported.map((line, index) => (
          <line
            key={index}
            x1={line.a.x}
            y1={line.a.y}
            x2={line.b.x}
            y2={line.b.y}
            stroke="#b14b43"
            strokeDasharray="5 3"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      <line
        x1={rotated ? -margin * 0.22 : width * 0.35}
        y1={rotated ? height * 0.35 : -margin * 0.22}
        x2={rotated ? -margin * 0.22 : width * 0.65}
        y2={rotated ? height * 0.65 : -margin * 0.22}
        stroke="#245b78"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        markerEnd={'url(#' + id + 'arrow)'}
      />
    </g>
  );
}
