window.EP_CONFIG = Object.freeze({
  MASTER_MODE: true,
  VERSION: "1.7.0-MASTER",
  CACHE_NAME: "ep-maneuver-v1.7-master"
});

// Ağır ECDIS konturlarında iPhone tarayıcısının kare atlamasını ve kıyı titremesini azaltır.
window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 33);
window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
