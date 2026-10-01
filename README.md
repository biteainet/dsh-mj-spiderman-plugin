# dsh-mj-spiderman · MJ 蜘蛛侠彩蛋插件（悬浮窗版）

在**任意输入框**输入 `mj`（不分大小写）→ 蜘蛛侠以**透明悬浮窗**浮现在界面上。
视频 + json 驱动，**WebGL 合成**（alpha 遮罩 + RGB 通道分离），参考 [shuliko.zh.kg](https://shuliko.zh.kg)。

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

蜘蛛侠即以透明贴图渲染进悬浮窗（无黑边、无底片），可拖可缩放。

## 资源

| 文件 | 说明 |
|---|---|
| `assets/video1.mp4` / `video2.mp4` | 彩蛋视频源（宽帧） |
| `assets/video1.json` / `video2.json` | WebGL 合成配置（帧坐标 / 尺寸 / 帧数） |
| `assets/mj.png` | 蜘蛛侠同人头像（站点原图） |
| `lib/index.js` | 插件本体（悬浮窗 + 合成 + 触发，无页面依赖） |

## 使用

### 方式 A：DeepSeek Harness / DSH 插件
按 DSH 插件规范安装本 npm 包，或直接把 `lib/index.js` 引入宿主页面：

```html
<script src="path/to/lib/index.js"></script>
```

加载后自动注册监听——**任意输入框**（input / textarea / contenteditable，含动态创建的）输入 `mj`（大小写不限）即触发。

### 方式 B：手动触发
```js
window.__dshMj.trigger();   // 直接弹出蜘蛛侠悬浮窗
window.__dshMj.hide();      // 关闭
```

## 悬浮窗交互

- **单指 / 鼠标拖动**：移动位置
- **双指捏合**：缩放（120px ~ 屏幕 90%）
- **右上角 × / 手动调用 hide**：关闭（桌面端鼠标悬停显示 ×）
- 视频播放完后保留最后一帧作为挂件悬浮，不会自动消失

## 兼容性

- 现代浏览器：WebGL 合成（透明悬浮）
- 旧浏览器 / WebGL 不可用：悬浮窗内直接播放 mp4（与站点 LegacyPlayer 一致）
- 移动端：`playsinline`、触摸拖动 / 捏合缩放

## 说明

- 视频与 json 均取自站点（video1 / video2 双素材随机播放）
- 触发不分大小写：`mj` / `MJ` / `Mj` 均有效
