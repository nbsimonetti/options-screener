import { useRef, useEffect } from 'react';

interface Props {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  filled?: boolean;
}

/**
 * Tiny canvas-based sparkline. No axes, no labels, no dependencies.
 * Normalizes values to fit within the given width/height.
 */
export default function Sparkline({ values, width = 80, height = 24, color = '#34d399', filled = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || values.length < 2) return;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const stepX = width / (values.length - 1);
    const pad = 2;
    const innerH = height - pad * 2;

    const pointY = (v: number) => pad + innerH - ((v - min) / range) * innerH;

    if (filled) {
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let i = 0; i < values.length; i++) {
        ctx.lineTo(i * stepX, pointY(values[i]));
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = color + '33';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.lineJoin = 'round';
    for (let i = 0; i < values.length; i++) {
      const x = i * stepX;
      const y = pointY(values[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [values, width, height, color, filled]);

  return <canvas ref={canvasRef} style={{ width, height }} />;
}
