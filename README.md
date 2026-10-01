# dsh-mj-spiderman-plugin · MJ 蜘蛛侠彩蛋插件（v0.6.0：修复倒立/触发冷却/实时生效，新增旋转滑块与保存按钮）（DSH Client 插件）

在 DeepSeek Harness 网页端**任意输入框**输入 `mj`（不分大小写）→ 蜘蛛侠以**透明悬浮窗**特效浮现在界面上，播放完自动消失。
视频 + json 驱动，**WebGL 合成**（alpha 遮罩 + RGB 通道分离），参考 [shuliko.zh.kg](https://shuliko.zh.kg)。

## 安装

```bash
dsh plugin --profile web add github:biteainet/dsh-mj-spiderman-plugin
# 重启 dsh web 生效
```

安装后浏览器端自动注入（标准 `dsh.client` Client 插件机制），无需手动配置。

## 原理（json + WebGL 合成）

彩蛋视频是「宽帧视频」——每一帧左右两半：

| 左半 | 右半 |
|---|---|
| `aFrame` 区域：alpha 遮罩（R 通道） | `rgbFrame` 区域：RGB 彩色画面 |

WebGL fragment shader 按 json 中的 `aFrame / rgbFrame / videoW / videoH` 坐标把两半分离采样：

```glsl
rgbPx = uRgbRect.xy + uv * uRgbRect.zw   // 采样右边彩图
aPx   = uARect.xy   + uv * uARect.zw     // 采样左边遮罩
a     = texture(a).r                      // R 通道作为 alpha
gl_FragColor = vec4(rgb * a, a);          // 透明背景合成
```

蜘蛛侠即以透明贴图渲染进悬浮窗（无黑边、无底片）。

## 结构（DSH 标准 Host + Client 双半）

| 文件 | 说明 |
|---|---|
| `lib/index.js` | **Host 半**（Node）：空实现，让包进入插件树，从而被 ClientModuleRegistry 扫描发现 |
| `lib/client.js` | **Client 半**（浏览器）：`__ModuleLoader__.load({id, factory})`，悬浮窗 + WebGL 合成 + 输入监听 + 设置面板；视频/json/头像全部 base64 内联（`/plugins/<id>/` 只服务 client bundle，不静态服务 assets） |
| `assets/` | 源码资源（video1/2.mp4、video1/2.json、mj.png），打包时可分发但不被运行时引用 |
| `cordis.patch.yml` | bundle 补丁：`- insert: {id: dsh-mj-spiderman-plugin, name: dsh-mj-spiderman-plugin}` |
| `package.json` | 声明 `dsh.client`（platform: web）+ `dsh.bundle.patch` + `exports["./client"]` |

## 使用

- 任意输入框（input / textarea / contenteditable，含动态创建的）输入 `mj`（大小写不限）→ 随机播放特效，播完自动消失
- **右侧小圆球**（蜘蛛侠头像）→ 打开设置面板
  - 特效 1 / 特效 2 两个 tab，**参数各自独立**：大小 / 上下 / 左右 / 左右镜像
  - **预览**按钮：循环播放当前选中特效（滑块即时生效）
  - 参数自动保存到 `localStorage`（`dsh_mj_perf`）
- 悬浮窗：`pointer-events: none`（点击穿透）、不可拖动、播完自动隐藏
- 手动 API：`window.__dshMj.trigger()` / `window.__dshMj.hide()` / `window.__dshMj.openPanel()`

## 兼容性

- WebGL 可用：透明合成悬浮窗
- WebGL 不可用 / 出错：悬浮窗内直接播放 mp4（降级）
- 移动端：`playsinline`

## 说明

- 视频与 json 均取自 shuliko.zh.kg（video1 / video2 双素材随机播放）
- 触发不分大小写：`mj` / `MJ` / `Mj` 均有效
