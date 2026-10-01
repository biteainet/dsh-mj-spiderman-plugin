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
| `lib/index.js` | 插件本体（悬浮窗 + 合成 + 触发；UMD 双模式：Cordis 插件导出 / 浏览器 script 自执行） |
| `cordis.patch.yml` | DSH bundle 配置补丁（安装时注册插件，官方 patch 语法） |
| `package.json` | DSH 插件包声明（含 dsh.bundle.patch 指向补丁） |

## 发布 / 安装

### 方式 A：GitHub 仓库安装（无需 npm 账号）
仓库根目录保持本包结构（package.json + cordis.patch.yml + lib/ + assets/），
打版本 tag（如 v0.1.0）并创建 Release，仓库添加 topic `dsh-plugin`，然后：
```bash
dsh plugin --profile web add github:biteainet/dsh-mj-spiderman-plugin
```

### 方式 B：npm 发布（正式社区包）
```bash
npm pack --dry-run   # 核对文件列表（lib、assets、cordis.patch.yml）
npm publish --access public
dsh plugin --profile web add dsh-mj-spiderman-plugin
```

### 方式 C：本地离线包（自测）
```bash
npm pack   # 生成 dsh-mj-spiderman-plugin-0.4.0.tgz
dsh plugin --profile web add ./dsh-mj-spiderman-plugin-0.4.0.tgz
```

## 使用

### 方式 D：DeepSeek Harness / DSH 插件
安装后由 DSH 加载 `lib/index.js`（Cordis 插件入口）；也可直接把 `lib/index.js` 引入宿主页面：

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
