/**
 * Wails runtime detection & browser-mode mock transport.
 *
 * 当用户直接在浏览器中打开 Vite 开发端口（如 127.0.0.1:3677）时,
 * Wails native shell 没有注入 IPC 桥, 所有 binding 调用都会向不存在的
 * /wails/runtime 端点发起 fetch, 触发 404 / setup 卡死。
 *
 * 此模块在 Vue 挂载前注入一个 `setTransport` mock,
 * 让浏览器开发场景下的 binding 直接返回预设的占位数据。
 * Wails 原生窗口下保持原行为(不安装 mock)。
 */
import { setTransport, objectNames } from '@wailsio/runtime'

declare global {
  interface Window {
    _wails?: {
      flags?: Record<string, unknown>
    }
  }
}

/** 是否运行在 Wails 原生窗口内（而不是浏览器直接访问 Vite 端口） */
export function isWailsRuntime(): boolean {
  return typeof window !== 'undefined' && !!window._wails && !!window._wails.flags
}

const STORAGE_PREFIX = 'ccx-browser-dev:'
const lsGet = (k: string) => {
  try { return localStorage.getItem(STORAGE_PREFIX + k) } catch { return null }
}
const lsSet = (k: string, v: string) => {
  try { localStorage.setItem(STORAGE_PREFIX + k, v) } catch { /* ignore */ }
}

const randomKey = () => {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return 'ccx-' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

const mockStatus = () => ({
  running: lsGet('running') === '1',
  starting: false,
  attached: false,
  port: 3000,
  url: 'http://127.0.0.1:3000',
  pid: lsGet('running') === '1' ? 1234 : 0,
  binaryPath: '(browser-dev)',
  dataDir: '(browser-dev)',
  health: { status: lsGet('running') === '1' ? 'ok' : 'unknown' },
  logs: [] as string[],
})

/**
 * binding ID → mock 返回值。
 * ID 来自 desktop/frontend/bindings/.../desktopservice.ts。
 * 未在此映射中的方法默认返回 null。
 */
const mocks: Record<number, (args: unknown[]) => unknown> = {
  // setup
  375603581: () => lsGet('setup-complete') === '1',                              // IsSetupComplete
  1874658839: () => randomKey(),                                                  // GenerateProxyAccessKey
  4130444060: () => ({ path: '(browser-dev)/.env', content: lsGet('env') ?? '' }), // GetEnvFile
  4266218857: ([content]) => { lsSet('env', String(content ?? '')); lsSet('setup-complete', '1') }, // SaveEnvFile
  355938326: () => lsGet('proxy-key') ?? '',                                      // GetProxyAccessKey

  // service control
  220274594: () => { lsSet('running', '1') },   // StartService
  2326025444: () => { lsSet('running', '0') },  // StopService
  194936479: () => { lsSet('running', '1') },   // RestartService
  2036427713: () => mockStatus(),               // GetStatus
  14751362: () => 'http://127.0.0.1:3000',      // WebURL

  // autostart
  1022089850: () => lsGet('autostart') === '1', // GetAutostartStatus
  3109129572: ([enabled]) => { lsSet('autostart', enabled ? '1' : '0') }, // SetAutostart

  // language / version / release
  717458672: () => ({ locale: lsGet('locale') ?? 'auto' }), // GetLanguagePreference
  1925265747: ([locale]) => { lsSet('locale', String(locale ?? 'auto')) }, // SaveLanguagePreference
  3507009081: () => ({ version: 'browser-dev', buildTime: '', gitCommit: '' }), // GetVersion
  4099134313: () => ({ hasUpdate: false, latest: '', current: 'browser-dev', publishedAt: '', releaseUrl: '', notes: '' }), // CheckLatestRelease

  // logs / channels / providers
  1688970508: () => [],   // GetLogs
  764436626: () => [],    // GetProviderPresets
  1999783760: () => [],   // GetProviderKeyAssets
  2703245855: () => ({}), // GetSavedProviderKeys
  3922694447: () => ({ provider: '', target: '', name: '', baseUrl: '', message: 'browser-dev: stub' }), // CreateCCXChannelFromPreset

  // agent config
  3013260948: ([platform]) => ({
    platform, provider: '', targetProvider: '', configured: false, matchesCurrentPort: false,
    needsUpdate: false, currentBaseUrl: '', targetBaseUrl: '', configPath: '(browser-dev)',
    hasState: false,
  }),
  2249637809: () => ({ files: [] }), // PreviewAgentConfigDiff
  2382293170: () => ({ files: [] }), // PreviewRestoreConfigDiff
  1194974726: () => undefined,        // ApplyAgentConfig
  3544811620: () => undefined,        // RestoreAgentConfig
  1308494416: () => [],              // DetectEditors

  // misc no-ops
  2418202931: ([text]) => { try { void navigator.clipboard.writeText(String(text ?? '')) } catch { /* ignore */ } }, // CopyText
  2081295652: () => undefined,  // OpenDirectory
  2255035236: () => undefined,  // OpenEnvFileInEditor
  1960821709: () => undefined,  // OpenFileInEditor
  2011844568: () => { window.open('http://127.0.0.1:3000', '_blank') }, // OpenWebUIInBrowser
  978526812: () => undefined,   // ShowAgentTab
  1026910485: () => undefined,  // ShowStatusTab
  1839858715: () => undefined,  // ShowWebUITab
  3879395531: () => undefined,  // Shutdown
}

/**
 * 在浏览器开发环境下安装 mock 传输层；Wails 原生窗口下不做任何事。
 * 必须在任何 @wailsio/runtime 调用发出之前调用。
 */
export function installBrowserMockTransport(): void {
  if (isWailsRuntime()) return

  setTransport({
    call: async (objectID: number, _method: number, _windowName: string, args: unknown) => {
      // objectID 0 = Call (binding 调用)；其余对象（Events/Dialog/Clipboard 等）一律 no-op
      if (objectID !== objectNames.Call) return null

      const opts = (args ?? {}) as { methodID?: number; methodName?: string; args?: unknown[] }
      const id = opts.methodID
      const callArgs = Array.isArray(opts.args) ? opts.args : []

      if (id != null && mocks[id]) {
        try {
          const result = mocks[id](callArgs)
          return result instanceof Promise ? await result : result
        } catch (err) {
          console.warn('[ccx-browser-dev] mock handler threw:', err)
          return null
        }
      }
      console.warn('[ccx-browser-dev] unmocked binding', { methodID: id, methodName: opts.methodName })
      return null
    },
  })

  // eslint-disable-next-line no-console
  console.info('[ccx-browser-dev] Wails runtime not detected — using browser mock transport')
}
