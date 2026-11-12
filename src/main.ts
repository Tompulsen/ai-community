import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { continuousCorners } from './continuous-corners'

createApp(App).directive('continuous', continuousCorners).use(router).mount('#app')
