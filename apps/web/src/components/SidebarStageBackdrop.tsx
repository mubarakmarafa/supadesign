import { useAtomValue } from "@effect/atom-react";
import { useId, useSyncExternalStore } from "react";

import { APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppStageLabel } from "../branding.logic";
import { useTheme } from "../hooks/useTheme";
import { primaryServerConfigAtom } from "../state/server";
import {
  getThemePreviewAppearance,
  subscribeToThemePreview,
  type ThemeAppearance,
} from "../themePalette";

export type EnvironmentIdentificationMode = "artwork" | "pill" | "none";
export type EnvironmentIdentificationPillLabel = "Dev" | "Nightly";

const STAGE_BACKDROP_VIEW_BOX = "0 0 8192 96";

export function isSidebarStageBackdropSupported(stageLabel: string | null): boolean {
  const normalized = stageLabel?.trim().toLowerCase();
  return (
    normalized === "nightly" ||
    normalized === "dev" ||
    normalized === undefined ||
    normalized === "latest"
  );
}

/** The production artwork is shared by every supported environment and only shows in dark themes. */
export function shouldShowSidebarStageBackdrop(
  stageLabel: string | null,
  appearance: ThemeAppearance,
): boolean {
  return isSidebarStageBackdropSupported(stageLabel) && appearance === "dark";
}

export function resolveEnvironmentIdentificationPillLabel(
  stageLabel: string | null,
): EnvironmentIdentificationPillLabel | null {
  const normalized = stageLabel?.trim().toLowerCase();
  if (normalized === "dev") return "Dev";
  if (normalized === "nightly") return "Nightly";
  return null;
}

export function useEnvironmentStageLabel(): string | null {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;

  return resolveServerBackedAppStageLabel({
    primaryServerVersion,
    fallbackStageLabel: APP_STAGE_LABEL,
  });
}

export function useSidebarStageBackdrop(enabled = true): boolean {
  const stageLabel = useEnvironmentStageLabel();
  const { resolvedTheme } = useTheme();
  const previewAppearance = useSyncExternalStore(
    subscribeToThemePreview,
    getThemePreviewAppearance,
    () => null,
  );
  return enabled && shouldShowSidebarStageBackdrop(stageLabel, previewAppearance ?? resolvedTheme);
}

/** The production header art is reused wherever environment artwork is enabled. */
export function SidebarStageBackdrop() {
  return (
    <div
      aria-hidden
      className="sidebar-stage-backdrop pointer-events-none absolute inset-x-0 top-0 z-0 h-20 select-none overflow-hidden"
    >
      <StageBackdropArt />
    </div>
  );
}

export function StageBackdropArt() {
  return <MeteorShowerArt />;
}

export function StageBackdropButtonArt() {
  return <MeteorShowerArt compact />;
}

type StageStar = { cx: number; cy: number; r: number; opacity: number };
type StageSparkle = { x: number; y: number };

function NightSkyGradient({ id }: { id: string }) {
  return (
    <linearGradient
      id={id}
      x1="24"
      y1="0"
      x2="264"
      y2="96"
      gradientUnits="userSpaceOnUse"
      spreadMethod="reflect"
    >
      <stop style={{ stopColor: "var(--stage-night-bottom)" }} />
      <stop offset="0.5" style={{ stopColor: "var(--stage-night-mid)" }} />
      <stop offset="1" style={{ stopColor: "var(--stage-night-top)" }} />
    </linearGradient>
  );
}

function NightStarsPattern({
  id,
  width,
  stars,
  sparkles,
}: {
  id: string;
  width: number;
  stars: ReadonlyArray<StageStar>;
  sparkles: ReadonlyArray<StageSparkle>;
}) {
  return (
    <pattern id={id} width={width} height="96" patternUnits="userSpaceOnUse">
      <g style={{ fill: "var(--stage-night-line)" }}>
        {stars.map((star) => (
          <circle
            key={`${star.cx}-${star.cy}`}
            cx={star.cx}
            cy={star.cy}
            r={star.r}
            fillOpacity={star.opacity}
          />
        ))}
      </g>
      <g
        style={{ stroke: "var(--stage-night-sparkle)" }}
        strokeLinecap="round"
        strokeOpacity="0.7"
        strokeWidth="0.6"
      >
        {sparkles.map(({ x, y }) => (
          <path key={`${x}-${y}`} d={`M${x - 1.5} ${y}H${x + 1.5}M${x} ${y - 1.5}V${y + 1.5}`} />
        ))}
      </g>
    </pattern>
  );
}

const METEOR_SHOWER_STARS: ReadonlyArray<StageStar> = [
  { cx: 12.2, cy: 50.1, r: 0.3, opacity: 0.3 },
  { cx: 254.3, cy: 56.4, r: 0.3, opacity: 0.3 },
  { cx: 168.2, cy: 35.7, r: 0.4, opacity: 0.5 },
  { cx: 37.5, cy: 5.4, r: 0.9, opacity: 0.9 },
  { cx: 16.6, cy: 20.8, r: 0.3, opacity: 0.3 },
  { cx: 62.8, cy: 0.6, r: 0.5, opacity: 0.5 },
  { cx: 174.5, cy: 21.9, r: 0.3, opacity: 0.5 },
  { cx: 204.4, cy: 31.9, r: 0.4, opacity: 0.5 },
  { cx: 33.5, cy: 22, r: 0.4, opacity: 0.3 },
  { cx: 36.4, cy: 65.3, r: 0.3, opacity: 0.7 },
  { cx: 108.5, cy: 19.7, r: 0.4, opacity: 0.7 },
  { cx: 112.1, cy: 40.8, r: 0.3, opacity: 0.6 },
  { cx: 118.3, cy: 24.3, r: 0.3, opacity: 0.6 },
  { cx: 232.8, cy: 36.8, r: 0.4, opacity: 0.5 },
  { cx: 135.5, cy: 43.9, r: 0.4, opacity: 0.4 },
  { cx: 21.5, cy: 8.4, r: 0.3, opacity: 0.5 },
  { cx: 125.6, cy: 17.6, r: 0.3, opacity: 0.6 },
  { cx: 130.1, cy: 58.7, r: 1, opacity: 0.9 },
  { cx: 91.5, cy: 58.1, r: 0.4, opacity: 0.7 },
  { cx: 2.8, cy: 57.1, r: 0.3, opacity: 0.3 },
  { cx: 3.4, cy: 58.9, r: 0.3, opacity: 0.3 },
  { cx: 103.3, cy: 6.7, r: 0.3, opacity: 0.3 },
  { cx: 233.8, cy: 57.9, r: 0.3, opacity: 0.5 },
  { cx: 147.6, cy: 58.9, r: 0.4, opacity: 0.5 },
  { cx: 2.8, cy: 17, r: 0.3, opacity: 0.5 },
  { cx: 220.7, cy: 55.1, r: 0.3, opacity: 0.3 },
  { cx: 98.7, cy: 39.3, r: 0.3, opacity: 0.3 },
  { cx: 65.6, cy: 27.5, r: 0.5, opacity: 0.3 },
  { cx: 260.9, cy: 58.5, r: 0.3, opacity: 0.4 },
  { cx: 269.6, cy: 51.8, r: 0.3, opacity: 0.5 },
  { cx: 113.9, cy: 67.4, r: 0.9, opacity: 0.9 },
  { cx: 214.1, cy: 30.3, r: 0.6, opacity: 0.7 },
  { cx: 171.1, cy: 21.3, r: 0.3, opacity: 0.5 },
  { cx: 257.8, cy: 51.4, r: 0.4, opacity: 0.5 },
  { cx: 201.4, cy: 11.3, r: 0.5, opacity: 0.4 },
  { cx: 199, cy: 58, r: 0.9, opacity: 0.9 },
  { cx: 230.6, cy: 32.7, r: 0.3, opacity: 0.6 },
  { cx: 273.7, cy: 21.9, r: 0.6, opacity: 0.3 },
  { cx: 61.9, cy: 34.2, r: 0.3, opacity: 0.6 },
  { cx: 127.9, cy: 58.2, r: 0.4, opacity: 0.6 },
  { cx: 14, cy: 34.5, r: 0.6, opacity: 0.3 },
  { cx: 59.7, cy: 19.3, r: 1, opacity: 0.9 },
  { cx: 16.5, cy: 9.7, r: 0.6, opacity: 0.5 },
  { cx: 211.6, cy: 70.1, r: 0.3, opacity: 0.7 },
  { cx: 215.1, cy: 47.7, r: 0.6, opacity: 0.3 },
  { cx: 134.4, cy: 66.6, r: 0.4, opacity: 0.6 },
  { cx: 244, cy: 53.2, r: 0.4, opacity: 0.7 },
  { cx: 69.5, cy: 13.6, r: 0.3, opacity: 0.3 },
  { cx: 28.3, cy: 45.7, r: 0.4, opacity: 0.6 },
  { cx: 71.9, cy: 53.3, r: 0.3, opacity: 0.7 },
  { cx: 216.8, cy: 27.3, r: 0.4, opacity: 0.3 },
  { cx: 156.9, cy: 31.8, r: 0.4, opacity: 0.3 },
  { cx: 155.5, cy: 11.1, r: 0.4, opacity: 0.7 },
  { cx: 228.4, cy: 47.4, r: 0.6, opacity: 0.4 },
  { cx: 275.9, cy: 70.6, r: 0.6, opacity: 0.6 },
  { cx: 127.5, cy: 18.1, r: 0.3, opacity: 0.4 },
  { cx: 51.6, cy: 58.7, r: 0.4, opacity: 0.5 },
  { cx: 38.6, cy: 67.7, r: 0.6, opacity: 0.6 },
  { cx: 74.7, cy: 9.5, r: 0.4, opacity: 0.7 },
  { cx: 99.1, cy: 14, r: 0.4, opacity: 0.4 },
  { cx: 84.4, cy: 38.3, r: 0.3, opacity: 0.7 },
  { cx: 73.7, cy: 14.8, r: 0.6, opacity: 0.6 },
  { cx: 52.3, cy: 24.1, r: 0.5, opacity: 0.3 },
  { cx: 277.5, cy: 17.3, r: 0.3, opacity: 0.6 },
  { cx: 76.7, cy: 46.3, r: 0.4, opacity: 0.6 },
  { cx: 216.2, cy: 50.4, r: 0.4, opacity: 0.7 },
  { cx: 118.8, cy: 64.6, r: 0.4, opacity: 0.7 },
  { cx: 243.7, cy: 65.3, r: 0.5, opacity: 0.6 },
  { cx: 42.9, cy: 13.4, r: 0.6, opacity: 0.6 },
  { cx: 272.6, cy: 46.4, r: 0.3, opacity: 0.6 },
  { cx: 227, cy: 42.3, r: 0.6, opacity: 0.4 },
  { cx: 156.2, cy: 26.3, r: 0.6, opacity: 0.3 },
  { cx: 20, cy: 3.9, r: 0.3, opacity: 0.6 },
  { cx: 34.5, cy: 11.4, r: 0.3, opacity: 0.3 },
  { cx: 49.3, cy: 34.4, r: 0.5, opacity: 0.3 },
  { cx: 45.6, cy: 11.5, r: 0.6, opacity: 0.7 },
  { cx: 179.2, cy: 39.1, r: 0.6, opacity: 0.4 },
  { cx: 116.2, cy: 37.2, r: 0.3, opacity: 0.6 },
  { cx: 175.3, cy: 34.2, r: 0.3, opacity: 0.6 },
  { cx: 92.1, cy: 70.7, r: 0.3, opacity: 0.6 },
  { cx: 79.6, cy: 6.3, r: 0.3, opacity: 0.3 },
  { cx: 164.6, cy: 51.4, r: 0.3, opacity: 0.6 },
  { cx: 206.2, cy: 48.9, r: 0.4, opacity: 0.5 },
  { cx: 98.8, cy: 57.3, r: 0.3, opacity: 0.7 },
  { cx: 44.4, cy: 61.2, r: 0.4, opacity: 0.7 },
  { cx: 65.1, cy: 28.7, r: 0.5, opacity: 0.5 },
  { cx: 119.9, cy: 59.4, r: 0.3, opacity: 0.3 },
  { cx: 65.1, cy: 49.6, r: 0.3, opacity: 0.3 },
  { cx: 168.6, cy: 5.5, r: 0.8, opacity: 0.9 },
  { cx: 111.7, cy: 64.9, r: 0.3, opacity: 0.5 },
  { cx: 196.6, cy: 31.5, r: 0.3, opacity: 0.7 },
  { cx: 280.9, cy: 28.9, r: 0.5, opacity: 0.5 },
  { cx: 285.5, cy: 32.2, r: 0.4, opacity: 0.4 },
  { cx: 85.9, cy: 34.8, r: 0.4, opacity: 0.7 },
  { cx: 267.4, cy: 57.3, r: 0.5, opacity: 0.7 },
  { cx: 144.8, cy: 21.4, r: 1, opacity: 0.9 },
  { cx: 257.8, cy: 32.7, r: 0.3, opacity: 0.4 },
  { cx: 246.6, cy: 52, r: 0.3, opacity: 0.6 },
  { cx: 180.2, cy: 62.1, r: 0.5, opacity: 0.6 },
  { cx: 137.5, cy: 5.5, r: 0.3, opacity: 0.3 },
  { cx: 280.3, cy: 55.4, r: 0.3, opacity: 0.3 },
  { cx: 264.7, cy: 60.2, r: 1, opacity: 0.9 },
  { cx: 16.8, cy: 52.6, r: 0.3, opacity: 0.7 },
  { cx: 69.9, cy: 69.2, r: 1, opacity: 0.9 },
  { cx: 142.7, cy: 44.5, r: 0.3, opacity: 0.3 },
  { cx: 106.3, cy: 29.7, r: 0.9, opacity: 1 },
  { cx: 153.5, cy: 31.7, r: 0.3, opacity: 0.7 },
  { cx: 15.5, cy: 9.7, r: 0.4, opacity: 0.5 },
  { cx: 155.1, cy: 14.3, r: 0.3, opacity: 0.7 },
  { cx: 67, cy: 23.5, r: 0.3, opacity: 0.7 },
  { cx: 126, cy: 69.7, r: 0.5, opacity: 0.4 },
  { cx: 147.4, cy: 38.7, r: 0.6, opacity: 0.3 },
  { cx: 22.6, cy: 55, r: 0.5, opacity: 0.7 },
  { cx: 177.2, cy: 1.9, r: 0.3, opacity: 0.3 },
  { cx: 260.7, cy: 71.6, r: 0.6, opacity: 0.5 },
  { cx: 105.3, cy: 47.5, r: 0.5, opacity: 0.3 },
  { cx: 243.2, cy: 32, r: 0.3, opacity: 0.4 },
  { cx: 10.9, cy: 7.9, r: 0.3, opacity: 0.4 },
  { cx: 84.7, cy: 64.9, r: 0.4, opacity: 0.7 },
  { cx: 19.5, cy: 9.5, r: 0.6, opacity: 0.5 },
  { cx: 111.8, cy: 41.5, r: 0.3, opacity: 0.5 },
  { cx: 272.9, cy: 50.7, r: 0.3, opacity: 0.4 },
  { cx: 158.4, cy: 42.6, r: 0.4, opacity: 0.4 },
  { cx: 198.6, cy: 1.1, r: 0.5, opacity: 0.7 },
  { cx: 19.3, cy: 44.6, r: 0.6, opacity: 0.7 },
  { cx: 39, cy: 48, r: 0.4, opacity: 0.7 },
  { cx: 142.7, cy: 50.8, r: 0.5, opacity: 0.3 },
  { cx: 102.9, cy: 20.2, r: 0.4, opacity: 0.6 },
  { cx: 128, cy: 57.5, r: 0.3, opacity: 0.6 },
  { cx: 284, cy: 39.8, r: 0.3, opacity: 0.3 },
  { cx: 216.8, cy: 35.9, r: 0.3, opacity: 0.7 },
  { cx: 122.4, cy: 30.7, r: 0.4, opacity: 0.3 },
  { cx: 171.6, cy: 50.3, r: 0.3, opacity: 0.5 },
  { cx: 93.6, cy: 64.4, r: 0.3, opacity: 0.4 },
  { cx: 256.4, cy: 7.6, r: 0.3, opacity: 0.7 },
  { cx: 186.1, cy: 19.9, r: 0.3, opacity: 0.3 },
  { cx: 243.3, cy: 1.7, r: 0.3, opacity: 0.3 },
  { cx: 203.9, cy: 58.6, r: 0.5, opacity: 0.6 },
  { cx: 198.5, cy: 10.6, r: 0.3, opacity: 0.4 },
  { cx: 268.5, cy: 48.6, r: 0.3, opacity: 0.3 },
];

const METEOR_SHOWER_SPARKLES: ReadonlyArray<StageSparkle> = [
  { x: 100, y: 16 },
  { x: 196, y: 40 },
  { x: 262, y: 28 },
];

const METEORS: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number; opacity: number }> =
  [
    { x1: 356, y1: 6, x2: 304.0, y2: 36.0, opacity: 1 },
    { x1: 260, y1: 4, x2: 225.4, y2: 24.0, opacity: 0.8 },
    { x1: 180, y1: 14, x2: 155.8, y2: 28.0, opacity: 0.6 },
  ];

function MeteorShowerArt({ compact = false }: { compact?: boolean }) {
  const idPrefix = useId().replaceAll(":", "");
  const skyId = `${idPrefix}-stage-meteor-sky`;
  const starsId = `${idPrefix}-stage-meteor-stars`;
  const meteorsId = `${idPrefix}-stage-meteor-trails`;
  const tailId = (index: number) => `${idPrefix}-stage-meteor-tail-${index}`;

  return (
    <svg
      data-stage-art="meteors"
      className="h-full w-full"
      fill="none"
      preserveAspectRatio="xMinYMin slice"
      viewBox={compact ? "96 0 8192 96" : STAGE_BACKDROP_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <NightSkyGradient id={skyId} />
        <NightStarsPattern
          id={starsId}
          width={288}
          stars={METEOR_SHOWER_STARS}
          sparkles={METEOR_SHOWER_SPARKLES}
        />
        {METEORS.map((meteor, index) => (
          <linearGradient
            key={meteor.x1}
            id={tailId(index)}
            x1={meteor.x1}
            y1={meteor.y1}
            x2={meteor.x2}
            y2={meteor.y2}
            gradientUnits="userSpaceOnUse"
          >
            <stop style={{ stopColor: "var(--stage-night-line)" }} />
            <stop
              offset="0.25"
              style={{ stopColor: "var(--stage-meteor-tail)" }}
              stopOpacity="0.85"
            />
            <stop offset="1" style={{ stopColor: "var(--stage-meteor-tail)" }} stopOpacity="0" />
          </linearGradient>
        ))}
        <pattern id={meteorsId} width="384" height="96" patternUnits="userSpaceOnUse">
          {METEORS.map((meteor, index) => (
            <g key={meteor.x1} opacity={meteor.opacity}>
              <path
                d={`M${meteor.x1} ${meteor.y1}L${meteor.x2} ${meteor.y2}`}
                stroke={`url(#${tailId(index)})`}
                strokeLinecap="round"
                strokeWidth="1.25"
              />
              <circle
                cx={meteor.x1}
                cy={meteor.y1}
                r="1.05"
                style={{ fill: "var(--stage-night-line)" }}
              />
            </g>
          ))}
        </pattern>
      </defs>

      <rect width="100%" height="96" fill={`url(#${skyId})`} />
      <rect width="100%" height="96" fill={`url(#${starsId})`} />
      <rect width="100%" height="96" fill={`url(#${meteorsId})`} />
    </svg>
  );
}
