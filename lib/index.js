/**
 * dsh-mj-spiderman-plugin · host half（Node 半）
 * 标准 DSH bundle 插件：client 半（lib/client.js）负责浏览器侧悬浮窗与触发。
 * Host 半为空实现，仅让包进入插件树，从而被 ClientModuleRegistry 扫描发现。
 */
export const name = 'dsh-mj-spiderman-plugin'

export function apply(ctx) {
  console.log('[dsh-mj-spiderman-plugin] host half loaded')
}
