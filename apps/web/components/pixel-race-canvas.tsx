"use client";

import { useEffect, useRef } from "react";

import { buildCarSprite, buildCarTrail, carPalette, type SpritePixel } from "@/lib/car-recipe";
import type { PublicRaceParticipant } from "@/lib/race-types";
import { scoreProgress } from "@/lib/scoring";
import { canvasThemes, type RaceThemeId } from "@/lib/theme";

interface PixelRaceCanvasProps {
  readonly animate: boolean;
  readonly description: string;
  readonly participants: readonly PublicRaceParticipant[];
  readonly theme: RaceThemeId;
}

const canvasWidth = 320;
const canvasHeight = 180;
const cityHeights = [23, 38, 29, 44, 19, 34, 47, 27, 41, 22, 35, 30, 46, 25, 39, 31];

function drawCity(context: CanvasRenderingContext2D, theme: RaceThemeId): void {
  const colors = canvasThemes[theme];
  context.fillStyle = colors.sky;
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  context.fillStyle = colors.skyline;
  for (const [index, height] of cityHeights.entries()) {
    const x = index * 21 - 5;
    context.fillRect(x, 72 - height, 17, height);
    context.fillStyle = colors.window;
    for (let windowY = 42; windowY < 68; windowY += 9) {
      if ((index + windowY) % 3 !== 0) {
        context.fillRect(x + 4, windowY, 3, 3);
        context.fillRect(x + 11, windowY, 3, 3);
      }
    }
    context.fillStyle = colors.skyline;
  }
}

function drawTrack(context: CanvasRenderingContext2D, theme: RaceThemeId, frame: number): void {
  const colors = canvasThemes[theme];
  context.fillStyle = colors.road;
  context.fillRect(0, 72, canvasWidth, canvasHeight - 72);
  context.fillStyle = colors.shoulder;
  context.fillRect(0, 72, canvasWidth, 4);
  context.fillRect(0, canvasHeight - 5, canvasWidth, 5);
  context.fillStyle = colors.lane;
  for (let lane = 1; lane < 6; lane += 1) {
    const y = 76 + lane * 17;
    for (let x = -16 + frame; x < canvasWidth; x += 32) {
      context.fillRect(x, y, 12, 2);
    }
  }
  const finishX = 286;
  for (let column = 0; column < 2; column += 1) {
    for (let row = 0; row < 26; row += 1) {
      context.fillStyle = (column + row) % 2 === 0 ? colors.foreground : colors.road;
      context.fillRect(finishX + column * 4, 76 + row * 4, 4, 4);
    }
  }
}

function pixelColor(pixel: SpritePixel, palette: ReturnType<typeof carPalette>): string | null {
  if (pixel === ".") {
    return null;
  }
  const colors: Record<Exclude<SpritePixel, ".">, string> = {
    a: palette.accent,
    b: palette.body,
    g: palette.glass,
    t: palette.trim,
    w: palette.wheel,
  };
  return colors[pixel];
}

function drawCar(
  context: CanvasRenderingContext2D,
  participant: PublicRaceParticipant,
  theme: RaceThemeId,
  x: number,
  y: number,
): void {
  const sprite = buildCarSprite(participant.car);
  const trail = buildCarTrail(participant.car);
  const palette = carPalette(participant.car, theme);
  const pixelSize = 2;
  context.fillStyle = palette.accent;
  for (const pixel of trail) {
    context.fillRect(
      Math.round(x) + pixel.x * pixelSize,
      Math.round(y) + pixel.y * pixelSize,
      pixelSize,
      pixelSize,
    );
  }
  for (const [rowIndex, row] of sprite.entries()) {
    for (const [columnIndex, pixel] of row.entries()) {
      const color = pixelColor(pixel, palette);
      if (color !== null) {
        context.fillStyle = color;
        context.fillRect(
          Math.round(x) + columnIndex * pixelSize,
          Math.round(y) + rowIndex * pixelSize,
          pixelSize,
          pixelSize,
        );
      }
    }
  }
}

function drawFrame(
  context: CanvasRenderingContext2D,
  participants: readonly PublicRaceParticipant[],
  theme: RaceThemeId,
  frame: number,
): void {
  context.imageSmoothingEnabled = false;
  drawCity(context, theme);
  drawTrack(context, theme, frame % 16);
  const visibleParticipants = participants.slice(0, 5);
  const leaderScore = visibleParticipants[0]?.weeklyScore ?? 0;
  for (const [index, participant] of visibleParticipants.entries()) {
    const progress = scoreProgress(participant.weeklyScore, leaderScore);
    const x = 18 + progress * 230 - index * 2;
    const bob = frame === 0 ? 0 : (frame + index) % 2;
    drawCar(context, participant, theme, x, 77 + index * 17 + bob);
  }
}

export function PixelRaceCanvas({
  animate,
  description,
  participants,
  theme,
}: PixelRaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const descriptionId = "pixel-race-description";

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context) {
      return undefined;
    }

    let animationFrame = 0;
    let previousStep = -1;
    const render = (timestamp: number) => {
      const step = animate ? Math.floor(timestamp / 140) : 0;
      if (step !== previousStep) {
        drawFrame(context, participants, theme, step);
        previousStep = step;
      }
      if (animate) {
        animationFrame = requestAnimationFrame(render);
      }
    };
    render(0);
    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [animate, participants, theme]);

  return (
    <div className="race-canvas-shell">
      <canvas
        aria-describedby={descriptionId}
        aria-label={description}
        className="race-canvas"
        height={canvasHeight}
        ref={canvasRef}
        role="img"
        width={canvasWidth}
      />
      <p className="sr-only" id={descriptionId}>
        {description}
      </p>
    </div>
  );
}
