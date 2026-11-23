import raw from "../data/params.json";

export type Params = typeof raw;
export type PreyKind = keyof Params["prey"];
export type PreySpec = Params["prey"][PreyKind];

export const defaultParams: Params = raw;

/** Species that exist only in the game: the realistic model (stocking, recruitment, calibration) skips them. */
export const isArcadeOnly = (spec: PreySpec): boolean => (spec as { arcadeOnly?: boolean }).arcadeOnly === true;
