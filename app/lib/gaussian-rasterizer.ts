/** SuperSplat's normalized, alpha-clipped forward Gaussian in Babylon UVs. */
export const SUPERSPLAT_GAUSSIAN_FRAGMENT = `vec4 gaussianColor(vec4 inColor)
{const float EXP4=exp(-4.0);const float INV_EXP4=1.0/(1.0-EXP4);float A=dot(vPosition,vPosition);if (A>4.0) discard;float B=((exp(-A)-EXP4)*INV_EXP4)*inColor.a;if (B<(1.0/255.0)) discard;
#include<logDepthFragment>
vec3 color=inColor.rgb;
#ifdef FOG
#include<fogFragment>
#endif
return vec4(color,B);}
`;

interface BabylonShaderStore {
  IncludesShadersStore: Record<string, string>;
}

/** Install before the first Gaussian material effect is compiled. */
export function installSuperSplatGaussianFragment(store: BabylonShaderStore): void {
  const key = "gaussianSplattingFragmentDeclaration";
  const current = store.IncludesShadersStore[key];
  if (current === SUPERSPLAT_GAUSSIAN_FRAGMENT) return;
  if (!current?.includes("float A=-dot(vPosition,vPosition)")) {
    throw new Error("Unsupported Babylon Gaussian fragment declaration");
  }
  store.IncludesShadersStore[key] = SUPERSPLAT_GAUSSIAN_FRAGMENT;
}
