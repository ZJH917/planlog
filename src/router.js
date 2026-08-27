import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('./views/HomeView.vue')
  },
  {
    path: '/detail/:workId',
    name: 'detail',
    component: () => import('./views/DetailView.vue')
  },
  {
    path: '/timeline/:workId',
    name: 'timeline',
    component: () => import('./views/TimelineView.vue')
  }
]

export default createRouter({
  history: createWebHashHistory(),
  routes
})