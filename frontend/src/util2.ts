export const mapObj = <T, T2>(
  obj: { [key: string]: T },
  pred: (x: T) => T2
): { [key: string]: T2 } =>
  Object.entries(obj).reduce((acc, [key, val]) => ({ ...acc, [key]: pred(val) }), {});
