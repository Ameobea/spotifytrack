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
