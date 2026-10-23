export const flagProfiles = {
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  default: [],
  'angle-only': ['--use-gl=angle'],
  'swiftshader-no-opt-in': ['--use-gl=angle', '--use-angle=swiftshader'],
  'disable-gpu': ['--disable-gpu'],
  'disable-gpu-and-software': ['--disable-gpu', '--disable-software-rasterizer'],
  'desktop-gl': ['--use-gl=desktop'],
  'disabled-webgl': ['--disable-webgl'],
} as const;
export type FlagProfile = keyof typeof flagProfiles;
export const isFlagProfile = (value: string): value is FlagProfile =>
  Object.hasOwn(flagProfiles, value);
