const originalLogInfo = console.info;
console.info = function(...args) {
  if (localStorage.getItem("osmo-ui-enable-logs") === "true") {
    originalLogInfo.apply(console, args);
  }
};
