import { createRouter, createWebHistory } from 'vue-router'
import DiscoverView from './views/DiscoverView.vue'
import WorkView from './views/WorkView.vue'
import CreateView from './views/CreateView.vue'
import LibraryView from './views/LibraryView.vue'
import ActivityView from './views/ActivityView.vue'
import CommunityView from './views/CommunityView.vue'
import AccountView from './views/AccountView.vue'
import { session } from './state'
import { loginReturnPath } from './login-navigation'
import AdminView from './views/AdminView.vue'
import NotFoundView from './views/NotFoundView.vue'
import MessagesView from './views/MessagesView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/discover' },
    { path: '/discover', component: DiscoverView, meta: { title: '首页' } },
    { path: '/work/:id', component: WorkView, meta: { title: '作品详情' } },
    { path: '/create/:kind?', component: CreateView, meta: { title: '创作台' } },
    { path: '/library', component: LibraryView, meta: { title: '我的作品' } },
    { path: '/activities', component: ActivityView, meta: { title: '推广中心' } },
    { path: '/community', component: CommunityView, meta: { title: '社区' } },
    { path: '/account', component: AccountView, meta: { title: '账号设置' } },
    { path: '/account/authorize', redirect: '/account' },
    { path: '/messages/:userId?', component: MessagesView, meta: { title: '消息' } },
    { path: '/admin', component: AdminView, meta: { title: '管理' } },
    { path: '/:pathMatch(.*)*', component: NotFoundView, meta: { title: '页面未找到' } },
  ],
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    if (to.path === from.path) return {}
    return { top: 0 }
  },
})

router.beforeEach((to, from) => {
  if (to.path === '/account' && !session.user && !to.query.returnTo && !to.query.newapi && !to.query.reset
    && from.matched.length && !from.path.startsWith('/account')) {
    return { path: to.path, query: { ...to.query, returnTo: loginReturnPath(from.fullPath) } }
  }
})
