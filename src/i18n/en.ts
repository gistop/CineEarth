/** English — the DEFAULT dictionary and the source of truth: every key used
 *  anywhere in the app must exist here first (zh is typed against it, so a
 *  missing translation is a compile error, not a silent English fallback). */
export const en = {
  /* drawer shell */
  'tab.shots': 'Shots',
  'tab.settings': 'Settings',
  'tab.assets': 'Assets',
  'drawer.close': 'Close (Esc)',

  /* Settings — section anchors */
  'set.imageryTerrain': 'Imagery & Terrain',
  'set.scene': 'Scene',
  'set.interface': 'Interface',

  /* data sources */
  'src.panelAria': 'Imagery and terrain services',
  'src.imagery.title': 'Imagery service — applied immediately',
  'src.imagery.ion.name': 'Ion · Bing',
  'src.imagery.ion.title':
    'Cesium World Imagery (Bing satellite) via ion — works on the shared token; a personal token (enter it below) lifts the quota',
  'src.imagery.esri.name': 'ArcGIS',
  'src.imagery.esri.title': 'Esri World Imagery — public service, no key',
  'src.imagery.tdt.name': 'Tianditu',
  'src.imagery.tdt.title': 'Tianditu satellite imagery + Chinese place labels — free key required',
  'src.imagery.keyPh': 'Paste your Tianditu key (free)',
  'src.apply': 'Apply',
  'src.tdt.note': 'Free key (browser-only storage):',
  'src.terrain.title': 'Terrain service',
  'src.terrain.ion.name': 'World',
  'src.terrain.ion.title': 'Cesium World Terrain via ion — shared token works out of the box',
  'src.terrain.arcgis.name': 'ArcGIS 3D',
  'src.terrain.arcgis.title': 'Esri WorldElevation3D / Terrain3D — public, no key, bathymetry included',
  'src.terrain.ellipsoid.name': 'Ellipsoid',
  'src.terrain.ellipsoid.title': 'No terrain — a smooth sphere, zero network',
  'src.state.loading': 'Switching imagery…',
  'src.state.missingKey': 'Tianditu needs its key — paste one below',
  'src.state.imageryFailed': 'Imagery source failed — network or key; pick another',
  'src.state.terrainLoading': 'Switching terrain…',
  'src.state.terrainFailed': 'Terrain source failed — network or key; pick another',

  /* ion token (shown when an ion service is selected) */
  'src.ion.title': 'Cesium ion token — optional',
  'src.ion.keyPh': 'Paste your ion token (optional)',
  'src.ion.save': 'Save & verify',
  'src.ion.clear': 'Clear',
  'src.ion.status.none': 'No token — ion services on the shared default',
  'src.ion.status.checking': 'Verifying your token…',
  'src.ion.status.valid': 'Token valid — ion services on your quota',
  'src.ion.status.invalid': 'Token invalid — still on shared default',
  'src.ion.status.unknown': 'Could not verify — still on shared default',
  'src.ion.note':
    "Terrain & imagery work on Cesium's shared evaluation token until you add your own. A personal token is stored only in this browser and used directly with",
  'src.ion.free': 'Free token:',

  /* layout */
  'layout.title': 'Layout — push reshapes only the window; the frame keeps the output aspect',
  'layout.push': 'Push',
  'layout.overlay': 'Overlay',
  'layout.push.hint':
    'Push: panels take real space and compress the map area; monitors keep the output aspect (letterboxed), the editor goes GES-style — beyond-frame content dims but stays visible and interactive',
  'layout.overlay.hint':
    'Overlay: panels float over the map, which always fills the window — maximum visible area, but panels cover part of the picture',

  /* theme */
  'theme.title': 'Interface theme — style only, applied instantly',
  'theme.bw.name': 'Mono',
  'theme.bw.hint': 'Near-black ground + pale gray text (Linear-style) — the UI fades to grayscale, color is left to the map and data',
  'theme.bwo.name': 'Mono Orange',
  'theme.bwo.hint':
    'Near-black + pale text + orange accent — orange marks only "now" (playhead / selection / keyframes), everything else grayscale',
  'theme.bwb.name': 'Mono Blue',
  'theme.bwb.hint':
    'Near-black + pale text + blue accent (QGIS/ArcGIS dark look) — blue shares its hue range with water and shadows; check before overlaying classification masks',
  'theme.bars.title': 'Track value bars — bar height reads the channel value at that moment',
  'theme.bars.hint': 'Bars inside each lane show the value (easing shape included; HOLD spans read flat). Curve mode is unaffected',
  'theme.bars.shown': 'Shown',
  'theme.bars.hidden': 'Hidden',

  /* language */
  'lang.title': 'Language — applied instantly',
  'lang.en': 'English',
  'lang.zh': '中文',

  /* scene switches */
  'scene.occlusion.name': 'Terrain occlusion',
  'scene.occlusion.hint': 'Depth test — lines & models are hidden behind mountains (needs world terrain)',
  'scene.groundAtmo.name': 'Ground atmosphere',
  'scene.groundAtmo.hint': 'Haze painted on the globe surface',
  'scene.skyAtmo.name': 'Sky atmosphere',
  'scene.skyAtmo.hint': 'Atmosphere shell around the planet',
  'scene.fog.name': 'Distance fog',
  'scene.fog.hint': 'Fades far terrain into the horizon',
  'scene.on': 'on',
  'scene.off': 'off',

  /* assets */
  'assets.drop.main': 'Drop .glb / .gltf models, KML / KMZ overlays, Excel points or shapefile zips here',
  'assets.drop.sub': 'or click to browse — models land at view centre; KML / Excel keep their own coordinates',
  'assets.remove': 'Remove',
  'assets.frame': 'Double-click to frame',
  'assets.loadFailed': 'load failed',

  /* sun panel */
  'sun.panelAria': 'Sun & time of day',
  'sun.title': 'Sun',
  'sun.play': 'Play time (600×)',
  'sun.pause': 'Pause time (600×)',
  'sun.reset': 'Reset to now',
  'sun.date': 'Date',
  'sun.time': 'Time of day',
  'sun.modeGroup': 'Day/night shading mode',
  'sun.mode.auto.label': 'Day/night (default)',
  'sun.mode.auto.title': 'Default — terminator shading from orbit, brightens automatically near the ground (stock Cesium)',
  'sun.mode.always.label': 'Day/night (always)',
  'sun.mode.always.title': 'Always — day/night shading holds at every zoom level; zoomed into the study area, night stays night',
  'sun.mode.off.label': 'Day/night (off)',
  'sun.mode.off.title': 'Off — shading fully disabled; the surface stays lit, the sun only moves',

  /* route drawer */
  'route.title': 'Route',
  'route.demo': 'Load demo',
  'route.demoTitle': 'Replace the current route with the Matterhorn demo fly-around',
  'route.demoDisabled': 'No shot selected',
  'route.empty': 'No shot selected — click a shot to start editing its route.',
  'route.addHint': 'Click the top-view map to add waypoints — or Load demo for an example.',
  'route.wpHint': 'Waypoints — camera keyframes',
  'route.noWp': 'No waypoints yet.',
  'route.poseOnly': 'Pose-only keyframe',
}

export type I18nKey = keyof typeof en
export type Dict = Record<I18nKey, string>
