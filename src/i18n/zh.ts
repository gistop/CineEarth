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

  /* map tools split button (timeline bar) */
  'tools.title': '地图工具',
  'tools.menuAria': '地图工具',
  'tools.exitDraw': '绘制中 — 点击取消',
  'tools.group.draw': '绘制',
  'tools.group.measure': '测量',
  'tools.soon': '即将上线',
  'tools.draw.line': '线',
  'tools.draw.point': '点',
  'tools.draw.polygon': '面',

  /* drawing mode */
  'draw.hint': '单击加点 · 双击或 ✓ 完成 · Esc 取消',
  'draw.finish': '完成',
  'draw.cancel': '取消',
  'draw.pts': '点',

  /* assets panel — drawn lines */
  'assets.tagDrawn': '绘制',
  'assets.style': '样式',
  'assets.lineColor': '颜色',
  'assets.lineWidth': '宽度',
  'assets.lineOpacity': '透明度',
  'assets.lineDashed': '虚线',
  'assets.lineClamped': '贴地',
  'assets.lineSection': '立体',
  'assets.animAdd': '加入时间轴动画（生长 / 离地）',
  'assets.animRemove': '移除时间轴动画',
  'assets.sectionSize': '截面尺寸',
  'assets.sectionAspect': '宽高比',
  'assets.lineLift': '离地高度',
  'assets.shape.none': '平面',
  'assets.shape.circle': '圆形',
  'assets.shape.square': '方形',
  'assets.shape.rectangle': '长方形',
  'assets.shape.ellipse': '椭圆',
  'assets.shape.diamond': '菱形',
  'assets.shape.triangle': '三角形',
  'assets.vertices': '个顶点',

  /* shot stack (timeline accordion) */
  'shot.defaultName': '机位 {n}',
  'shot.headerTitle':
    '时长 {dur}s · 双击名字重命名 · 点击切换编辑该机位（三角 = 展开或收起详细轨道）· 拖到主输出轨道 = 在落点添加该机位的镜头段',
  'shot.fold': '收起详细轨道',
  'shot.unfold': '展开详细轨道',
  'shot.ariaFold': '收起 {name} 的详细轨道',
  'shot.ariaUnfold': '展开 {name} 的详细轨道',
  'shot.del': '删除机位',
  'shot.delAria': '删除 {name}',
  'shot.grab': '拖动调整机位顺序',
  'shot.add': '新建机位',

  /* stage panes / program monitor */
  'stage.editThis': '编辑此机位',
  'stage.noWaypoints': '尚无航点',
  'stage.editActive': '编辑机位',
  'stage.editActiveEmpty': '编辑机位 · 尚无航点',
  'stage.programEmpty': '主输出未编排',
  'stage.programEmptyHint': '把播放头放到某处，点击一个机位',
  'stage.programChip': '成片画面 — 主输出轨当前在播的机位',
  'stage.program': '主输出',
  'stage.collapse': '收起到缩略条',
  'stage.collapseAria': '收起该机位',
  'stage.expand': '展开到主视图',
  'stage.expandAria': '展开该机位',
  'stage.thumbHint': '已收起 — 点击 ⤢ 展开后编辑',
  'stage.thumbHintActive': '当前编辑机位 — 在主视图大窗中编辑',
  'stage.dragHandle': '拖动调整视图顺序',

  /* timeline header & settings */
  'tl.heightAria': '时间轴高度',
  'tl.heightTitle': '拖动调整高度 · 双击复位',
  /* phone bar: the two edge popovers that hold the rest of the clusters */
  'tl.popTools': '工具 —— 点击向上展开',
  'tl.popMore': '更多 —— 点击向上展开',
  'tl.renderNoRoute': '未选中机位 — 无可渲染的航线',
  'tl.screenshot': '截图',
  'tl.render': '渲染视频 (MP4)',
  'tl.rendering': '渲染中 {p}% — 点击取消',
  'tl.renderFail': '渲染失败',
  'tset.title': '时间轴设置',
  'tset.close': '关闭时间轴设置',
  'tset.length': '长度',
  'tset.fit': '内容总长 {dur}s — 有关键帧在时长之外（数据已保留）· 点击适配内容总长',
  'tset.lengthTitle': '时间轴长度（{unit}）— 回车确认',
  'tset.unitAria': '长度单位',
  'tset.sec': '秒',
  'tset.frame': '帧',
  'tset.scale': '缩放',
  'tset.scaleTitle': '改变时长时，等比缩放现有关键帧的时长',
  'tset.insert': '插入',
  'tset.strategyAria': '插入策略',
  'tset.strategyTitle':
    '地图上点击插入航点时段时长的分配方式 — 固定：每段固定时长；均分：时间轴长度等分给所有段，末端关键帧始终落在时间轴末端；距离：按航点间地理距离比例分配。切换只影响之后的插入，不改动现有段',
  'tset.stFixed': '固定',
  'tset.stEven': '均分',
  'tset.stDist': '距离',
  'tset.fps': '帧率',
  'tset.fpsTitle': '帧率 (fps)',
  'tset.size': '尺寸',
  'tset.widthAria': '宽度',
  'tset.heightAria': '高度',
  'tset.sizeTitle': '输出{dim} (px) — 回车确认；画幅框与导出分辨率同时生效',
  'tset.keys': '关键帧',
  'tset.keysTitle': '航点（相机关键帧）数量 — 在地图上点击添加',

  /* ruler */
  'ruler.zoomTitle':
    '拖灰色区域平移 · 拖两端缩放 · 空白处刷选窗口 · 单击定位播放头 · 双击复位全程',
  'ruler.scrubTitle': '拖动刮擦播放头',
  'ruler.playhead': '播放头',
  'ruler.valueText': '{s} 秒，第 {f} 帧',
  'tl.growthRow': '生长 % · 双击：加关键帧 · 拖动：时间 / 百分比 · 双击关键帧：删除',
  'tl.growthKey': '{v}% @ {t}s',

  /* program track */
  'program.title':
    '主输出编排 — 单击段选中（Delete 磁性删除 · 数字键换机位 · 拖动换位）· 双击段换机位 · 拖动边界改切换时间（吸附）· 双击边界删除（合并）· 拖机位到本轨添加镜头 · B 分割 · P 在播放头插入激活机位',
  'program.label': '主输出',
  'program.cuts': '{n} 次切换',
  'program.unarranged': '未编排',
  'program.segTitle': '{name} · {dur}s — 单击选中 · 双击换机位 · 拖动换位 · Delete 删除',
  'program.segEmpty': '未编排',
  'program.boundaryTitle':
    '{name} @ {t}s — 拖动改切换时间（吸附，Alt 自由）· 单击选中后段 · 双击删除（合并）',
  'program.relink': '切换为…（或按数字键）',
  'program.lockOn': '主输出已锁定 — 切镜与全部编辑被拒绝（可继续浏览/激活机位）',
  'program.lockOff': '锁定主输出 — 防止误编辑（激活切镜、拖动、键盘命令全部只读）',
  'program.cutLocked': '主输出已锁定 — 激活不再切镜',
  'program.cutOn': '可切镜',
  'program.cutOff': '不切镜',

  /* camera channel rows. .short = phone-breakpoint label column (96px): the
     相机 prefix carries no information there (the 机位 header sits one row
     up), full names only ever muddle into "相机…" ellipses */
  'ch.lon': '相机经度',
  'ch.lon.short': '经度',
  'ch.lat': '相机纬度',
  'ch.lat.short': '纬度',
  'ch.height': '相机海拔',
  'ch.height.short': '海拔',
  'ch.heading': '相机平移',
  'ch.heading.short': '平移',
  'ch.pitch': '相机倾斜',
  'ch.pitch.short': '倾斜',
  'ch.roll': '相机翻滚',
  'ch.roll.short': '翻滚',
  'ch.fov': '相机视野',
  'ch.fov.short': '视野',
  'ch.valueAria': '编辑{label}关键帧值',
  'ch.valueTitle': '点击修改该值',
  'ch.valueShow': '显示/隐藏本通道关键帧右下角的值',
  'ch.valueToggle': '切换本通道关键帧值显示',
  'ch.insertPos': '在播放头处插入关键帧（位置组：经度/纬度/海拔 同步落键）',
  'ch.insertSolo': '在播放头处插入关键帧（仅本通道落键）',
  'ch.keyTitle': '{title} · 拖动改时间与值 · 右键设置缓动',
  'ch.handle': '拖动缓动手柄',

  /* easing menu */
  'ease.linear': '线性',
  'ease.both': '左右缓动',
  'ease.in': '缓入 · 左手柄',
  'ease.out': '缓出 · 右手柄',
  'ease.step': '跳跃',
  'ease.keyFallback': '关键帧',
  'ease.menuTitle': '{title} · 缓动',
  'ease.clear': '清除缓动',

  /* timeline widgets */
  'w.soloTitle': '{label} — 单击选中：右侧显示该通道曲线，左侧列表保持全部；再次单击取消',
  'w.insertTitle': '在播放头处插入{label}关键帧',
  'w.insertAria': '插入{label}关键帧',

  /* asset animation tracks */
  'aam.growth': '生长',
  'aam.lift': '离地',
  'aam.header': '{name} 资产动画 · 三角展开或收起通道 · × 移除动画（恢复静态样式）',
  'aam.fold': '收起通道',
  'aam.unfold': '展开通道',
  'aam.ariaFold': '收起 {name} 的通道',
  'aam.ariaUnfold': '展开 {name} 的通道',
  'aam.frames': '{n} 帧',
  'aam.remove': '移除动画（恢复静态样式）',
  'aam.removeAria': '移除 {name} 的动画',
  'aam.badge': '资产动画',
  'aam.laneFold': '{label} · 双击：加关键帧 · 拖动关键帧：时间 / 值 · 双击关键帧：删除 · 点击左侧标签进入曲线编辑',
  'aam.laneOpen': '{label} · 双击：加关键帧 · 拖动关键帧：时间 / 值 · 双击关键帧：删除 · 点击左侧标签退出曲线编辑',
  'aam.keyTitle': '{label}{unit} @ {t}s · 拖动改时间与值 · 双击删除',

  /* export failures (shown on the render button) */
  'export.noRoutes': '没有可用的机位航线',
  'export.notArranged': '主输出尚未编排 — 先在时间轴编排切镜',
  'export.noViewer': '主视图未就绪',
  'export.needKeys': '航线至少需要 2 个位置关键帧',
  'export.h264': '当前浏览器不支持 H.264 编码（需要 Chrome/Edge 的 WebCodecs）',
  'export.webcodecs': '当前浏览器不支持 WebCodecs，无法录制视频',
  'export.badCanvas': '画布尺寸无效，无法录制',
  'export.badScale': '无法创建缩放画布，无法录制',
}
