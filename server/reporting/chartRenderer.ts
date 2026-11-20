import fs from 'fs';
import { Resvg } from '@resvg/resvg-js';

export const CHART_PALETTE = [
  '#2B5B84', // navy blue
  '#9E3B33', // dark red
  '#77933C', // olive green
  '#604A7B', // purple
  '#31859C', // teal
  '#C56A28', // burnt orange
  '#4F81BD', // royal blue
  '#C0504D', // crimson
  '#9BBB59', // sage
  '#8064A2', // violet
  '#4BACC6', // cyan
  '#F79646', // peach
  '#D99694', // soft rose
  '#95B3D7', // soft blue
] as const;

export interface ChartCategoryPoint {
  category: string;
  count: number;
  percentage: number;
}

const SYSTEM_FONT_PATHS = [
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
].filter((p) => fs.existsSync(p));

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapLabelIntoLines(label: string, maxCharsPerLine = 38, maxLines = 2): string[] {
  const cleaned = label.trim();
  if (!cleaned) return [''];
  if (cleaned.length <= maxCharsPerLine) return [cleaned];

  const words = cleaned.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxCharsPerLine) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) {
        // Fill remaining words onto last line, truncating smoothly if exceeded
        continue;
      }
    }
  }
  if (current) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    const head = lines.slice(0, maxLines - 1);
    const tail = lines.slice(maxLines - 1).join(' ');
    const clippedTail =
      tail.length > maxCharsPerLine
        ? `${tail.slice(0, maxCharsPerLine - 3).trimEnd()}...`
        : tail;
    return [...head, clippedTail];
  }

  const lastIdx = lines.length - 1;
  if (lines[lastIdx].length > maxCharsPerLine) {
    lines[lastIdx] = `${lines[lastIdx].slice(0, maxCharsPerLine - 3).trimEnd()}...`;
  }
  return lines;
}

function computeNiceAxisMax(rawMax: number): number {
  if (rawMax <= 4) return 4;
  const roughStep = rawMax / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / magnitude;
  let niceResidual = 10;
  if (residual <= 1) niceResidual = 1;
  else if (residual <= 2) niceResidual = 2;
  else if (residual <= 2.5) niceResidual = 2.5;
  else if (residual <= 5) niceResidual = 5;
  const niceStep = niceResidual * magnitude;
  return Math.max(4, Math.ceil(niceStep * 4));
}

export function renderCategoryBarChartPng(
  data: ChartCategoryPoint[],
  title = 'Complaints by Issue Type'
): Buffer {
  // Logical vector dimensions (rendered at 2x Retina scale -> 1600x960 px for 14 rows)
  const logicalWidth = 800;
  const rowCount = Math.max(1, data.length);
  const rowPitch = data.length <= 14 ? 26.8 : 26;
  const plotTop = 48;
  const bottomPad = 56;
  const logicalHeight = Math.max(480, Math.ceil(plotTop + rowCount * rowPitch + bottomPad));
  const plotBottom = logicalHeight - bottomPad;
  const plotHeight = plotBottom - plotTop;

  const plotLeft = 264;
  const plotRight = 676;
  const plotWidth = plotRight - plotLeft;

  const rawMax = Math.max(1, ...data.map((d) => d.count));
  const axisMax = computeNiceAxisMax(rawMax);
  const ticks = [0, 1, 2, 3, 4].map((t) => Math.round((axisMax * t) / 4));

  const fontStack =
    "'Liberation Sans', 'Segoe UI', 'Arial', 'DejaVu Sans', sans-serif";

  const svgParts: string[] = [];
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${logicalWidth}" height="${logicalHeight}" viewBox="0 0 ${logicalWidth} ${logicalHeight}">`
  );

  // Outer card background & subtle crisp border
  svgParts.push(
    `<rect x="1" y="1" width="${logicalWidth - 2}" height="${logicalHeight - 2}" rx="8" ry="8" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.2" />`
  );

  // Chart Title
  svgParts.push(
    `<text x="${logicalWidth / 2}" y="28" text-anchor="middle" font-family="${fontStack}" font-size="15.5" font-weight="700" fill="#0F172A">${escapeXml(
      title
    )}</text>`
  );

  // Subtle horizontal alternating bands inside plot area
  if (data.length > 0) {
    data.forEach((_, idx) => {
      if (idx % 2 === 1) {
        const bandY = plotTop + idx * rowPitch;
        svgParts.push(
          `<rect x="${plotLeft}" y="${bandY.toFixed(1)}" width="${plotWidth}" height="${rowPitch.toFixed(
            1
          )}" fill="#F8FAFC" />`
        );
      }
    });
  }

  // Vertical Gridlines & X-Axis Ticks
  ticks.forEach((tickVal, idx) => {
    const gx = plotLeft + (plotWidth * idx) / 4;
    const strokeColor = idx === 0 ? '#64748B' : '#CBD5E1';
    const strokeWidth = idx === 0 ? '1.2' : '0.9';
    svgParts.push(
      `<line x1="${gx.toFixed(1)}" y1="${plotTop}" x2="${gx.toFixed(
        1
      )}" y2="${plotBottom}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />`
    );
    svgParts.push(
      `<text x="${gx.toFixed(1)}" y="${plotBottom + 17}" text-anchor="middle" font-family="${fontStack}" font-size="10" fill="#475569">${escapeXml(
        tickVal.toLocaleString('en-US')
      )}</text>`
    );
  });

  // Bottom X-axis baseline & centered axis title
  svgParts.push(
    `<line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="#64748B" stroke-width="1.2" />`
  );
  svgParts.push(
    `<text x="${(plotLeft + plotRight) / 2}" y="${plotBottom + 38}" text-anchor="middle" font-family="${fontStack}" font-size="11.5" font-weight="700" fill="#334155">Number of Complaints</text>`
  );

  if (data.length === 0) {
    svgParts.push(
      `<text x="${logicalWidth / 2}" y="${
        plotTop + plotHeight / 2
      }" text-anchor="middle" font-family="${fontStack}" font-size="12" fill="#64748B">No categorized complaints available</text>`
    );
  } else {
    const barHeight = Math.min(16, Math.max(10, rowPitch - 9));

    data.forEach((item, idx) => {
      const rowTop = plotTop + idx * rowPitch;
      const centerY = rowTop + rowPitch / 2;
      const barY = centerY - barHeight / 2;
      const color = CHART_PALETTE[idx % CHART_PALETTE.length];
      const barW =
        item.count > 0 ? Math.max(3, (item.count / axisMax) * plotWidth) : 0;

      // Multi-line wrapped Y-axis category label (right-aligned inside wide 264px margin)
      const lines = wrapLabelIntoLines(item.category, 38, 2);
      if (lines.length === 1) {
        svgParts.push(
          `<text x="${plotLeft - 10}" y="${(centerY + 3.5).toFixed(
            1
          )}" text-anchor="end" font-family="${fontStack}" font-size="9.5" fill="#1E293B">${escapeXml(
            lines[0]
          )}</text>`
        );
      } else {
        const firstLineY = centerY - 2;
        const secondLineY = centerY + 9.5;
        svgParts.push(
          `<text x="${plotLeft - 10}" y="${firstLineY.toFixed(
            1
          )}" text-anchor="end" font-family="${fontStack}" font-size="9.2" fill="#1E293B">${escapeXml(
            lines[0]
          )}</text>`
        );
        svgParts.push(
          `<text x="${plotLeft - 10}" y="${secondLineY.toFixed(
            1
          )}" text-anchor="end" font-family="${fontStack}" font-size="9.2" fill="#1E293B">${escapeXml(
            lines[1]
          )}</text>`
        );
      }

      // Colored horizontal bar
      if (barW > 0) {
        svgParts.push(
          `<rect x="${plotLeft}" y="${barY.toFixed(1)}" width="${barW.toFixed(
            1
          )}" height="${barHeight.toFixed(1)}" rx="2" ry="2" fill="${color}" />`
        );
      }

      // Crisp formatted value label beside each bar
      const valueText = `${item.count.toLocaleString('en-US')} (${item.percentage.toFixed(
        1
      )}%)`;
      svgParts.push(
        `<text x="${(plotLeft + barW + 8).toFixed(1)}" y="${(centerY + 3.5).toFixed(
          1
        )}" text-anchor="start" font-family="${fontStack}" font-size="9.8" font-weight="700" fill="#0F172A">${escapeXml(
          valueText
        )}</text>`
      );
    });
  }

  svgParts.push('</svg>');
  const svg = svgParts.join('\n');

  // Render SVG at 2x Retina DPI (1600px wide x 960+ px tall)
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: logicalWidth * 2 },
    font: {
      fontFiles: SYSTEM_FONT_PATHS,
      loadSystemFonts: true,
      defaultFontFamily: 'Liberation Sans',
    },
  });

  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}
