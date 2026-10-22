/** Flat SVG compass; one camera supplies orientation in every view. */
export const compassRose = () => `<svg viewBox="0 0 100 100" aria-hidden="true">
  <circle class="compass-ring" cx="50" cy="50" r="32"/>
  <g class="compass-rotation">
    <path class="compass-ticks" d="M50 18v4m32 28h-4M50 82v-4M18 50h4M27.4 27.4l2.8 2.8m42.4-2.8-2.8 2.8m2.8 42.4-2.8-2.8m-42.4 2.8 2.8-2.8"/>
    <path class="compass-diagonals" d="m35 35 15 10 15-10-10 15 10 15-15-10-15 10 10-15z"/>
    <path class="compass-point" d="m50 50 6-6 22 6-22 6zM50 50l6 6-6 22-6-22zM50 50l-6 6-22-6 22-6z"/>
    <path class="compass-facet" d="m50 50 28 0-22 6zM50 50v28l-6-22zM50 50H22l22-6z"/>
    <path class="compass-north" d="m50 22 6 22-6 6-6-6z"/>
    <path class="compass-north-facet" d="M50 22v28l-6-6z"/>
    <circle class="compass-hub" cx="50" cy="50" r="2.4"/>
  </g>
  <g class="compass-cardinals" text-anchor="middle" dominant-baseline="central">
    <text data-direction="0" class="compass-north-label" x="50" y="7">N</text>
    <text data-direction="90" x="93" y="50">E</text>
    <text data-direction="180" x="50" y="93">S</text>
    <text data-direction="270" x="7" y="50">W</text>
  </g>
</svg>`;
