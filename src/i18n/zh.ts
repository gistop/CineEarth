/** 中文（简体）— typed against the en dictionary: every key must be present,
 *  otherwise tsc fails. Add new strings to en.ts FIRST, then mirror here. */
import type { Dict } from './en'

export const zh: Dict = {
  /* drawer shell */
  'tab.shots': '镜头',
  'tab.settings': '设置',
  'tab.assets': '资产',
  'drawer.close': '关闭 (Esc)',

  /* Settings — section anchors */
  'set.imageryTerrain': '影像与地形',
  'set.scene': '画面渲染',
  'set.interface': '界面',

  /* data sources */
  'src.panelAria': '影像与地形服务',
  'src.imagery.title': '影像服务 — 选中即生效',
  'src.imagery.ion.name': 'Ion · Bing',
  'src.imagery.ion.title':
    'Cesium World Imagery（Bing 卫星）经 ion 分发 — 共享 token 即可用；个人 token（下方输入）可提升配额',
  'src.imagery.esri.name': 'ArcGIS',
  'src.imagery.esri.title': 'Esri World Imagery — 公共服务，免 key',
  'src.imagery.tdt.name': '天地图',
  'src.imagery.tdt.title': '天地图卫星影像 + 中文地名注记 — 需免费 key',
  'src.imagery.keyPh': '粘贴天地图 key（免费）',
  'src.apply': '应用',
  'src.tdt.note': '免费申请（仅存本浏览器）：',
  'src.terrain.title': '地形服务',
  'src.terrain.ion.name': 'World',
  'src.terrain.ion.title': 'Cesium World Terrain（经 ion）— 共享 token 开箱即用',
  'src.terrain.arcgis.name': 'ArcGIS 3D',
  'src.terrain.arcgis.title': 'Esri WorldElevation3D / Terrain3D — 公共服务，免 key，含海底地形',
  'src.terrain.ellipsoid.name': '椭球',
  'src.terrain.ellipsoid.title': '无地形 — 光滑椭球，零网络请求',
  'src.state.loading': '正在切换影像…',
  'src.state.missingKey': '天地图需要 key — 请在下方粘贴',
  'src.state.imageryFailed': '影像源加载失败 — 网络或 key 问题；换一个试试',
  'src.state.terrainLoading': '正在切换地形…',
  'src.state.terrainFailed': '地形源加载失败 — 网络或 key 问题；换一个试试',

  /* ion token */
  'src.ion.title': 'Cesium ion token — 可选',
  'src.ion.keyPh': '粘贴 ion token（可选）',
  'src.ion.save': '保存并验证',
  'src.ion.clear': '清除',
  'src.ion.status.none': '未填 token — ion 服务走共享默认',
  'src.ion.status.checking': '正在验证 token…',
  'src.ion.status.valid': 'token 有效 — ion 服务走你的配额',
  'src.ion.status.invalid': 'token 无效 — 仍走共享默认',
  'src.ion.status.unknown': '无法验证 — 仍走共享默认',
  'src.ion.note':
    '地形与影像开箱即用（走 Cesium 共享评估 token）；填入个人 token 后切到自己的配额。token 只存在本浏览器、直连',
  'src.ion.free': '免费 token：',

  /* layout */
  'layout.title': '布局 — Push 只改变窗口形状，画幅始终保持输出比例',
  'layout.push': '挤压',
  'layout.overlay': '覆盖',
  'layout.push.hint':
    '挤压：面板占用真实空间、压缩地图区域；监视窗保持输出画幅（等比居中），编辑窗为 GES 式 —— 画幅框外暗显超范围（仍可见、仍可交互）',
  'layout.overlay.hint': '覆盖：面板浮在地图上，地图始终铺满窗口 —— 可见区域最大，但面板会遮住画面',

  /* theme */
  'theme.title': '界面主题 — 仅样式，立即生效',
  'theme.bw.name': '黑白',
  'theme.bw.hint': '近黑底 + 微白字（Linear 风）— 界面退成灰阶，颜色留给地图与数据',
  'theme.bwo.name': '黑白橙',
  'theme.bwo.hint': '近黑底 + 微白字 + 橙强调 — 橙只标“当前”（播放头/选中/关键帧），其余灰阶',
  'theme.bwb.name': '黑白蓝',
  'theme.bwb.hint': '近黑底 + 微白字 + 蓝强调（QGIS/ArcGIS 暗色观感）— 蓝与水体、阴影同色域，叠分类 mask 前留意',
  'theme.bars.title': '轨道值柱 — 柱高表示该时刻通道值的高低',
  'theme.bars.hint': '轨道车道内用柱子高低表示值（含缓动形状，HOLD 段为平柱）。曲线模式不受影响',
  'theme.bars.shown': '显示',
  'theme.bars.hidden': '隐藏',

  /* language */
  'lang.title': '界面语言 — 立即生效',
  'lang.en': 'English',
  'lang.zh': '中文',

  /* scene switches */
  'scene.occlusion.name': '地形遮挡',
  'scene.occlusion.hint': '深度测试 — 线与模型被山体遮挡（需世界地形）',
  'scene.groundAtmo.name': '地面大气',
  'scene.groundAtmo.hint': '画在球面的雾霭',
  'scene.skyAtmo.name': '天空大气',
  'scene.skyAtmo.hint': '包裹行星的大气壳',
  'scene.fog.name': '距离雾',
  'scene.fog.hint': '远处地形渐隐入地平线',
  'scene.on': '开',
  'scene.off': '关',

  /* assets */
  'assets.drop.main': '拖放 .glb / .gltf 模型、KML / KMZ 叠加层、Excel 点位或 shapefile 压缩包到此处',
  'assets.drop.sub': '或点击浏览 —— 模型落在视图中心；KML / Excel 保留自身坐标',
  'assets.remove': '移除',
  'assets.frame': '双击定位',
  'assets.loadFailed': '加载失败',

  /* sun panel */
  'sun.panelAria': '太阳与时刻',
  'sun.title': '太阳',
  'sun.play': '播放时间（600×）',
  'sun.pause': '暂停时间（600×）',
  'sun.reset': '回到当前时刻',
  'sun.date': '日期',
  'sun.time': '时刻',
  'sun.modeGroup': '昼夜明暗模式',
  'sun.mode.auto.label': '昼夜（默认）',
  'sun.mode.auto.title': '默认 — 远景有昼夜明暗，贴近地面后自动变亮（Cesium 出厂行为）',
  'sun.mode.always.label': '昼夜（全程）',
  'sun.mode.always.title': '全程 — 昼夜明暗在任何缩放级别都生效，放大到研究区夜里仍是夜',
  'sun.mode.off.label': '昼夜（关闭）',
  'sun.mode.off.title': '关闭 — 昼夜明暗完全关闭，地表恒亮，太阳只移动位置不出明暗',

  /* route drawer */
  'route.title': '航线',
  'route.demo': '加载示例',
  'route.demoTitle': '用马特洪峰示例航线替换当前航线',
  'route.demoDisabled': '未选中机位',
  'route.empty': '未选中机位 — 点击某个机位开始编辑航线。',
  'route.addHint': '点击俯视图添加航点 —— 或加载示例看看效果。',
  'route.wpHint': '航点 —— 相机关键帧',
  'route.noWp': '还没有航点。',
  'route.poseOnly': '仅姿态关键帧',

  /* side view */
  'route.side.caption': '侧视 · 高度剖面',
  'route.side.fit': '适应航线（重置缩放与平移）',
  'route.side.fitAria': '适应航线',
  'route.side.zoomIn': '放大',
  'route.side.zoomOut': '缩小',
  'route.side.aria':
    '航线高度剖面 —— 垂直拖动航点调整高度，拖动空白处平移，工具栏按钮或双指缩放，双击复位',
  'route.side.hint':
    '垂直拖动航点设置高度 · 拖动空白处平移（左右 = 沿线距离，上下 = 高度）· 工具栏按钮或双指缩放 · 双击复位',

  /* attitude gauge */
  'route.attitude.caption': '姿态',
  'route.attitude.aria': '姿态仪 —— 外圈：朝向；中央：俯仰（上下拖动）；内圈小环：横滚；扇形：视场角',
  'route.attitude.playhead': '播放头',
}
