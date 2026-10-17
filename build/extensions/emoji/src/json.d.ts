/**
 * Ambient JSON module shim. The generated lucide-metadata.json is ~1 MB of
 * data; keeping it out of the type program (no resolveJsonModule) avoids
 * inferring literal types for every entry. Runtime consumers (bun, esbuild)
 * load JSON natively.
 */
declare module '*.json' {
  const value: unknown;
  export default value;
}
