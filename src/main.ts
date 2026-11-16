import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { continuousCorners } from './continuous-corners'
import { walletPrefetch } from './wallet-prefetch'

createApp(App).directive('continuous', continuousCorners).directive('wallet-prefetch', walletPrefetch).use(router).mount('#app')
