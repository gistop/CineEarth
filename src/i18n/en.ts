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

  /* side view */
  'route.side.caption': 'Side view · elevation',
  'route.side.fit': 'Fit route (reset zoom and pan)',
  'route.side.fitAria': 'Fit route',
  'route.side.zoomIn': 'Zoom in',
  'route.side.zoomOut': 'Zoom out',
  'route.side.aria':
    'Route elevation profile — drag waypoints vertically to change altitude, drag empty space to pan, zoom with the toolbar buttons or pinch, double-click to reset',
  'route.side.hint':
    'Drag a waypoint vertically to set altitude · drag empty space to pan (left/right = along-track, up/down = altitude) · zoom with the toolbar buttons or pinch · double-click to reset',

  /* attitude gauge */
  'route.attitude.caption': 'Attitude',
  'route.attitude.aria':
    'Attitude gauge — outer ring: heading, centre: pitch (drag up/down), inner ring: roll, wedge: field of view',
  'route.attitude.playhead': 'playhead',

  /* map tools split button (timeline bar) */
  'tools.title': 'Map tools',
  'tools.menuAria': 'Map tools',
  'tools.exitDraw': 'Drawing — click to cancel',
  'tools.group.draw': 'Draw',
  'tools.group.measure': 'Measure',
  'tools.soon': 'Coming soon',
  'tools.draw.line': 'Line',
  'tools.draw.point': 'Point',
  'tools.draw.polygon': 'Polygon',

  /* drawing mode */
  'draw.hint': 'Click to add points · double-click or ✓ to finish · Esc to cancel',
  'draw.finish': 'Finish',
  'draw.cancel': 'Cancel',
  'draw.pts': 'pts',

  /* assets panel — drawn lines */
  'assets.tagDrawn': 'drawn',
  'assets.style': 'Style',
  'assets.lineColor': 'Colour',
  'assets.lineWidth': 'Width',
  'assets.lineOpacity': 'Opacity',
  'assets.lineDashed': 'Dashed',
  'assets.lineClamped': 'Clamp to ground',
  'assets.lineSection': 'Extrusion',
  'assets.animAdd': 'Add to timeline (growth / lift)',
  'assets.animRemove': 'Remove from timeline',
  'assets.sectionSize': 'Section size',
  'assets.sectionAspect': 'Aspect',
  'assets.lineLift': 'Elevation',
  'assets.shape.none': 'Flat',
  'assets.shape.circle': 'Circle',
  'assets.shape.square': 'Square',
  'assets.shape.rectangle': 'Rectangle',
  'assets.shape.ellipse': 'Ellipse',
  'assets.shape.diamond': 'Diamond',
  'assets.shape.triangle': 'Triangle',
  'assets.vertices': 'vertices',

  /* shot stack (timeline accordion) */
  'shot.defaultName': 'Cam {n}',
  'shot.headerTitle':
    'Length {dur}s · double-click the name to rename · click to edit this shot (caret = fold/unfold detail tracks) · drag onto the Program track = add its segment at the drop point',
  'shot.fold': 'Fold detail tracks',
  'shot.unfold': 'Unfold detail tracks',
  'shot.ariaFold': 'Fold detail tracks of {name}',
  'shot.ariaUnfold': 'Unfold detail tracks of {name}',
  'shot.del': 'Delete shot',
  'shot.delAria': 'Delete {name}',
  'shot.grab': 'Drag to reorder shots',
  'shot.add': 'New shot',

  /* stage panes / program monitor */
  'stage.editThis': 'Edit this shot',
  'stage.noWaypoints': 'No waypoints yet',
  'stage.editActive': 'Editing shot',
  'stage.editActiveEmpty': 'Editing shot · no waypoints yet',
  'stage.programEmpty': 'Program not cut yet',
  'stage.programEmptyHint': 'Park the playhead somewhere, then click a shot',
  'stage.programChip': 'The finished picture — the shot the Program track has on air at the playhead',
  'stage.program': 'Program',
  'stage.collapse': 'Collapse to the thumb rail',
  'stage.collapseAria': 'Collapse this shot',
  'stage.expand': 'Expand to the editor view',
  'stage.expandAria': 'Expand this shot',
  'stage.thumbHint': 'Collapsed — click ⤢ to expand & edit',
  'stage.thumbHintActive': 'Current edit target — edit it in the main view',
  'stage.dragHandle': 'Drag to reorder views',

  /* timeline header & settings */
  'tl.heightAria': 'Timeline height',
  'tl.heightTitle': 'Drag to resize · double-click to reset',
  'tl.renderNoRoute': 'No shot selected — no route to render',
  'tl.screenshot': 'Screenshot',
  'tl.render': 'Render video (MP4)',
  'tl.rendering': 'Rendering {p}% — click to cancel',
  'tl.renderFail': 'Render failed',
  'tset.length': 'Length',
  'tset.fit': 'Content runs {dur}s — keys exist past the length (kept) · click to fit',
  'tset.lengthTitle': 'Timeline length ({unit}) — Enter to apply',
  'tset.unitAria': 'Length unit',
  'tset.sec': 'sec',
  'tset.frame': 'frm',
  'tset.scale': 'Scale',
  'tset.scaleTitle': 'When the length changes, re-time existing keys proportionally',
  'tset.insert': 'Insert',
  'tset.strategyAria': 'Insert strategy',
  'tset.strategyTitle':
    'How the duration of a map-clicked waypoint segment is allocated — Fixed: every segment the same length; Even: the timeline length divided across all segments, the last key always lands on the end; Distance: proportional to the geographic distance between waypoints. Switching only affects future inserts — existing segments keep their timing',
  'tset.stFixed': 'Fixed',
  'tset.stEven': 'Even',
  'tset.stDist': 'Distance',
  'tset.fps': 'Frame rate',
  'tset.fpsTitle': 'Frame rate (fps)',
  'tset.size': 'Size',
  'tset.widthAria': 'Width',
  'tset.heightAria': 'Height',
  'tset.sizeTitle': 'Output {dim} (px) — Enter to apply; the frame guide and the export resolution follow together',
  'tset.keys': 'Keys',
  'tset.keysTitle': 'Waypoints (camera keyframes) — click the map to add',

  /* ruler */
  'ruler.zoomTitle':
    'Drag the grey band to pan · drag either end to zoom · drag empty space to marquee a window · click to park the playhead · double-click to reset',
  'ruler.scrubTitle': 'Drag to scrub the playhead',
  'ruler.playhead': 'playhead',
  'ruler.valueText': '{s} s · frame {f}',
  'tl.growthRow': 'Growth % · double-click: add key · drag: time / % · double-click key: delete',
  'tl.growthKey': '{v}% @ {t}s',

  /* program track */
  'program.title':
    'Program edits — click a segment to select (Delete = magnetic remove · number keys relink · drag reorders) · double-click a segment to relink · drag a boundary to re-time the cut (snaps) · double-click a boundary to delete (merge) · drag a shot header here to add its segment · B = blade · P = insert the active shot at the playhead',
  'program.label': 'Program',
  'program.cuts': '{n} cuts',
  'program.unarranged': 'not cut yet',
  'program.segTitle': '{name} · {dur}s — click to select · double-click to relink · drag reorders · Delete removes',
  'program.segEmpty': 'not cut',
  'program.boundaryTitle':
    '{name} @ {t}s — drag to re-time the cut (snaps, Alt = free) · click selects the segment after it · double-click deletes (merge)',
  'program.relink': 'Relink… (or number keys)',
  'program.lockOn': 'Program locked — cuts and every edit rejected (browse / activate freely)',
  'program.lockOff': 'Lock the program — protects against accidental edits (activation cuts, drags and keyboard commands all read-only)',
  'program.cutLocked': 'Program locked — activating no longer cuts',
  'program.cutOn': 'Cuts on',
  'program.cutOff': 'No cuts',

  /* camera channel rows */
  'ch.lon': 'Cam longitude',
  'ch.lat': 'Cam latitude',
  'ch.height': 'Cam altitude',
  'ch.heading': 'Cam pan',
  'ch.pitch': 'Cam tilt',
  'ch.roll': 'Cam roll',
  'ch.fov': 'Cam FOV',
  'ch.valueAria': 'Edit {label} key value',
  'ch.valueTitle': 'Click to edit the value',
  'ch.valueShow': 'Show / hide the value at each key\u2019s bottom-right',
  'ch.valueToggle': 'Toggle key values for this channel',
  'ch.insertPos': 'Insert a key at the playhead (position group: lon / lat / alt key together)',
  'ch.insertSolo': 'Insert a key at the playhead (this channel only)',
  'ch.keyTitle': '{title} · drag to retime / revalue · right-click for easing',
  'ch.handle': 'Drag the easing handle',

  /* easing menu */
  'ease.linear': 'Linear',
  'ease.both': 'Ease both',
  'ease.in': 'Ease in · left handle',
  'ease.out': 'Ease out · right handle',
  'ease.step': 'Step',
  'ease.keyFallback': 'Key',
  'ease.menuTitle': '{title} · easing',
  'ease.clear': 'Clear easing',

  /* timeline widgets */
  'w.soloTitle': '{label} — click to solo: its curve opens on the right while the list keeps every channel; click again to dismiss',
  'w.insertTitle': 'Insert a {label} key at the playhead',
  'w.insertAria': 'Insert {label} key',

  /* asset animation tracks */
  'aam.growth': 'Growth',
  'aam.lift': 'Lift',
  'aam.header': '{name} asset animation · caret folds channels · × removes the animation (static style returns)',
  'aam.fold': 'Fold channels',
  'aam.unfold': 'Unfold channels',
  'aam.ariaFold': 'Fold channels of {name}',
  'aam.ariaUnfold': 'Unfold channels of {name}',
  'aam.frames': '{n} frm',
  'aam.remove': 'Remove animation (static style returns)',
  'aam.removeAria': 'Remove animation from {name}',
  'aam.badge': 'Asset anim',
  'aam.laneFold': '{label} · double-click: add key · drag key: time / value · double-click key: delete · click the left label to open curve editing',
  'aam.laneOpen': '{label} · double-click: add key · drag key: time / value · double-click key: delete · click the left label to leave curve editing',
  'aam.keyTitle': '{label}{unit} @ {t}s · drag to retime / revalue · double-click deletes',

  /* export failures (shown on the render button) */
  'export.noRoutes': 'No shot routes to render',
  'export.notArranged': 'Program not cut yet — arrange cuts on the timeline first',
  'export.noViewer': 'Main view not ready',
  'export.needKeys': 'A route needs at least 2 position keys',
  'export.h264': 'This browser cannot encode H.264 (WebCodecs on Chrome / Edge required)',
  'export.webcodecs': 'This browser lacks WebCodecs — video export unavailable',
  'export.badCanvas': 'Invalid canvas size — cannot record',
  'export.badScale': 'Could not create the scaling canvas — cannot record',
}

export type I18nKey = keyof typeof en
export type Dict = Record<I18nKey, string>
