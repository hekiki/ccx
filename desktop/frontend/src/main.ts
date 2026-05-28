import { createApp } from 'vue'
import App from './App.vue'
import './assets/index.css'
import { installBrowserMockTransport } from './lib/wails-runtime'

// 必须在任何依赖 @bindings 的 composable 执行前安装,
// 否则浏览器直接打开 Vite 端口时所有 IPC 都会发到不存在的 /wails/runtime。
installBrowserMockTransport()

createApp(App).mount('#app')
