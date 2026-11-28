// Recovery must be reachable before importing chat, media restoration or the app router.
if (window.location.pathname.replace(/\/+$/, '') === '/storage-recovery') {
  void import('./recovery-bootstrap')
} else {
  void import('./app-bootstrap')
}
