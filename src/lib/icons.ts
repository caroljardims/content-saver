const NS = 'http://www.w3.org/2000/svg';

/**
 * Hand-rolled rather than pulled from an icon package: eight outline glyphs
 * is a few hundred bytes here versus a dependency, and stroke-based paths on
 * `currentColor` inherit the palette automatically in both themes.
 */
export const ICON_PATHS = {
  bookmark: ['M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'],
  chevron: ['m9 18 6-6-6-6'],
  sync: [
    'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',
    'M21 3v5h-5',
    'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
    'M8 16H3v5',
  ],
  page: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'M14 2v5h5'],
  selection: ['M4 7h16', 'M4 12h10', 'M4 17h7'],
  external: [
    'M15 3h6v6',
    'M10 14 21 3',
    'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  ],
  copy: [
    'M20 8H10a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2z',
    'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  ],
  share: ['M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8', 'm16 6-4-4-4 4', 'M12 2v13'],
  trash: [
    'M3 6h18',
    'm19 6-.8 14a2 2 0 0 1-2 2H7.8a2 2 0 0 1-2-2L5 6',
    'M10 11v6',
    'M14 11v6',
    'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  ],
  cloud: ['M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'],
  check: ['M20 6 9 17l-5-5'],
} as const;

export type IconName = keyof typeof ICON_PATHS;

/**
 * Built with createElementNS rather than innerHTML. The paths are our own
 * constants so markup injection is not a real risk here, but keeping the
 * whole popup free of innerHTML means nobody has to check which is which.
 */
export function icon(name: IconName, className = 'size-3.5'): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `shrink-0 ${className}`);

  for (const d of ICON_PATHS[name]) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }

  return svg;
}
