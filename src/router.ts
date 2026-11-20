import { createRouter, createWebHistory } from 'vue-router'
import DiscoverView from './views/DiscoverView.vue'
import MessagesView from './views/MessagesView.vue'
import { session } from './state'
import { loginReturnPath } from './login-navigation'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/discover' },
    { path: '/discover', component: DiscoverView, meta: { title: '首页' } },
    { path: '/work/:id', component: () => import('./views/WorkView.vue'), meta: { title: '作品详情' } },
    { path: '/create/:kind?', component: () => import('./views/CreateView.vue'), meta: { title: '创作台' } },
    { path: '/library', component: () => import('./views/LibraryView.vue'), meta: { title: '我的作品' } },
    { path: '/activities', component: () => import('./views/ActivityView.vue'), meta: { title: '福利中心' } },
    { path: '/community', component: () => import('./views/CommunityView.vue'), meta: { title: '社区' } },
    { path: '/account', component: () => import('./views/AccountView.vue'), meta: { title: '账号设置' } },
    { path: '/account/authorize', redirect: '/account' },
    { path: '/messages/:userId?', component: MessagesView, meta: { title: '消息' } },
    { path: '/admin', component: () => import('./views/AdminView.vue'), meta: { title: '管理' } },
    { path: '/:pathMatch(.*)*', component: () => import('./views/NotFoundView.vue'), meta: { title: '页面未找到' } },
  ],
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    if (to.path === from.path) return {}
    return { top: 0 }
  },
})

router.beforeEach((to, from) => {
  if (to.path === '/account' && to.query.tab === 'following') {
    return { path: '/messages', query: { tab: 'activity' }, hash: '#follow-requests' }
  }
  if (to.path === '/community' && to.query.tab === 'announcements' && !to.query.creator) {
    return { path: '/messages', query: { tab: 'announcement' } }
  }
  if (to.path === '/account' && !session.user && !to.query.returnTo && !to.query.newapi && !to.query.reset
    && from.matched.length && !from.path.startsWith('/account')) {
    return { path: to.path, query: { ...to.query, returnTo: loginReturnPath(from.fullPath) } }
  }
})
