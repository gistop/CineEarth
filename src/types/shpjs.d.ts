// Minimal ambient typings for shpjs (the package ships no .d.ts).
// Usage: `import shp from 'shpjs'` → parse a shapefile zip buffer into GeoJSON.
// A zip holding several shapefile sets resolves to an array of collections.
declare module 'shpjs' {
  export interface ShpFeatureCollection {
    type: 'FeatureCollection'
    features: Record<string, unknown>[]
  }
  export default function shp(
    input: ArrayBuffer | Uint8Array | string,
  ): Promise<ShpFeatureCollection | ShpFeatureCollection[]>
}
