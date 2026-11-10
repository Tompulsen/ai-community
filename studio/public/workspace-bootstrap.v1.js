(function () {
  if (window.location.pathname === "/studio/community-embed") return;
  if (window.__octopusWorkspaceStarted || window.__octopusWorkspaceBootstrap)
    return;
  window.__octopusWorkspaceEpoch = window.__octopusWorkspaceEpoch || 0;
  function invalidate() {
    window.__octopusWorkspaceEpoch++;
    var pending = window.__octopusWorkspaceBootstrap;
    if (pending) {
      pending.invalidated = true;
      pending.cancel();
    }
  }
  window.addEventListener("storage", function (event) {
    if (event.key === "octopus-new-api-session") invalidate();
  });
  if ("BroadcastChannel" in window) {
    var channel = new BroadcastChannel("octopus-new-api-session");
    channel.addEventListener("message", function (event) {
      if (event.data && event.data.type === "session-changed") invalidate();
    });
  }
  window.__octopusWorkspaceWatching = true;
  var controller = new AbortController();
  var timeout = setTimeout(function () {
    controller.abort();
  }, 15000);
  window.__octopusWorkspaceBootstrap = {
    startedAt: Date.now(),
    cancel: function () {
      controller.abort();
    },
    finish: function () {
      clearTimeout(timeout);
    },
    response: fetch("/studio/api/new-api/bootstrap", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    }).catch(function () {
      clearTimeout(timeout);
      return null;
    }),
  };
})();
