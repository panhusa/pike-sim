import raw from "../data/params.json";

export type Params = typeof raw;
export type PreyKind = keyof Params["prey"];
export type PreySpec = Params["prey"][PreyKind];

export const defaultParams: Params = raw;
