export const BACKGROUND_COLOR = 0x010101;
export const PRIMARY_NODE_COLOR = [0x0fd108, 0xff3838, 0x3370ff, 0xb545ff];
export const SECONDARY_NODE_COLOR = 0x6ab9c;
export const SELECTED_NODE_COLOR = 0xffd700;
export const PRIMARY_CONNECTED_TO_SELECTED_NODE_COLOR = [0x12e20b, 0xff3838, 0x3370ff, 0xb545ff];
export const SECONDARY_CONNECTED_TO_SELECTED_NODE_COLOR = 0x6ab9c;
export const DULL_PRIMARY_NODE_COLOR = [0x2a5828, 0x6c3338, 0x17367a, 0x501b6c];
export const DULL_SECONDARY_NODE_COLOR = 0x176960;
export const EDGE_COLOR = 0x9b9b9b;
export const DULL_EDGE_COLOR = 0x424242;

/**
 * Above this many nodes (or on mobile), the layout uses the cheaper midpoint integrator
 * instead of RK4
 */
export const MIDPOINT_INTEGRATOR_NODE_THRESHOLD = 300;

/** Brightness multiplier applied to node fills when no node is selected */
export const DEFAULT_NODE_DIM = 0.86;

/**
 * Adaptive integrator: if p90 of recent active layout tick times is below the upgrade
 * threshold, midpoint is upgraded to RK4 (~2x cost, smoother); above the downgrade
 * threshold, RK4 falls back to midpoint.  Gap between them provides hysteresis.
 */
export const RK4_UPGRADE_TICK_MS = 2.5;
export const RK4_DOWNGRADE_TICK_MS = 6;
export const ADAPT_WINDOW = 48;

/**
 * Until the user takes control of the camera, it follows the graph's center of mass as the
 * layout settles.
 */
export const AUTO_CENTER_LERP = 0.12;

/**
 * Auto-framing zoom sits between the default zoom and a full fit, falling off logarithmically
 * in the graph's overflow past the viewport: bigger graphs keep opening the view up, but with
 * diminishing returns, so a huge graph ends up cropped rather than shrunk to an illegible
 * speck.  The extent driving it is the node bounding box capped at `AUTO_ZOOM_OUTLIER_SIGMAS`
 * standard deviations so a stray far-flung component can't dominate.
 */
export const AUTO_ZOOM_PADDING_PX = 28;
export const AUTO_ZOOM_FALLOFF = 0.3;
export const AUTO_ZOOM_MIN_NODE_DEVICE_PX = 10;
export const AUTO_ZOOM_OUTLIER_SIGMAS = 2.75;

/** Pitch of the sunflower spiral that expanded-in nodes are seeded onto around their parent */
export const EXPANSION_SEED_RADIUS = 40;
