/**
 * Pixel icon set for the DOM HUD (R-13.9). Each icon is a tiny character map ('#' = ink)
 * rendered as a crisp SVG path filled with `currentColor`. Icons therefore never depend on
 * emoji or symbol fonts (which render as empty boxes on many systems) and always inherit
 * the contrast-checked text color of the control they sit in.
 */
export const ICONS = {
  undo: ['...#.....', '..##.....', '.#######.', '..##....#', '...#....#', '........#', '.......#.', '..#####..', '.........'],
  play: ['..#......', '..##.....', '..###....', '..####...', '..#####..', '..####...', '..###....', '..##.....', '..#......'],
  menu: ['.#######.', '.#######.', '.........', '.#######.', '.#######.', '.........', '.#######.', '.#######.'],
  warn: ['....#....', '...###...', '...#.#...', '..##.##..', '..##.##..', '.#######.', '.###.###.', '#########'],
  check: ['........#', '.......##', '......##.', '#....##..', '##..##...', '.####....', '..##.....'],
  leaf: ['....#####', '..#######', '.#####.##', '.####.##.', '.###.##..', '.##.##...', '.#.##....', '#........'],
  ring: ['...###...', '.##...##.', '.#.....#.', '#.......#', '#.......#', '#.......#', '.#.....#.', '.##...##.', '...###...'],
  lock: ['...###...', '..#...#..', '..#...#..', '.#######.', '.#######.', '.###.###.', '.###.###.', '.#######.'],
  star: ['....#....', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.'],
  pause: ['.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.'],
  dot: ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'],
  zz: ['####.....', '..#......', '.#.......', '####.....', '.....####', '.......#.', '......#..', '.....####'],
  diamond: ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'],
  // Arrow key caps for the key-binding list (↑ ↓ ← → are missing from many system fonts).
  arrowUp: ['....#....', '...###...', '..#####..', '.#######.', '...###...', '...###...', '...###...', '...###...'],
  arrowDown: ['...###...', '...###...', '...###...', '...###...', '.#######.', '..#####..', '...###...', '....#....'],
  arrowLeft: ['........', '...#....', '..##....', '.#######', '########', '.#######', '..##....', '...#....', '........'],
  arrowRight: ['........', '....#...', '....##..', '#######.', '########', '#######.', '....##..', '....#...', '........'],
  // Hint (a light bulb) and lens (an eye) controls next to the map.
  bulb: ['..#####..', '.#.....#.', '#.......#', '#...#...#', '.#..#..#.', '..#.#.#..', '...###...', '...###...', '....#....'],
  eye: ['...###...', '.##...##.', '#...#...#', '#..###..#', '#...#...#', '.##...##.', '...###...'],
  // Small up / down marks for the turn report chips.
  up: ['...#...', '..###..', '.#####.', '#######', '..###..', '..###..'],
  down: ['..###..', '..###..', '#######', '.#####.', '..###..', '...#...'],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;

/** SVG path data covering exactly the inked pixels, one horizontal run per sub-path. */
export function iconPath(name: IconName): string {
  let d = '';
  ICONS[name].forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== '#') {
        x++;
        continue;
      }
      let n = 0;
      while (row[x + n] === '#') n++;
      d += `M${x} ${y}h${n}v1h-${n}z`;
      x += n;
    }
  });
  return d;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A decorative (aria-hidden) inline icon; meaning is always carried by adjacent text. */
export function icon(name: IconName, cls = ''): SVGSVGElement {
  const rows = ICONS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${rows[0].length} ${rows.length}`);
  svg.setAttribute('class', cls ? `ico ${cls}` : 'ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', iconPath(name));
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('shape-rendering', 'crispEdges');
  svg.append(path);
  return svg;
}
