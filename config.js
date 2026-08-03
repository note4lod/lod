window.EP_CONFIG = Object.freeze({
  MASTER_MODE: false,
  VERSION: "1.6.0",
  CACHE_NAME: "mariner-academy-v1.6-toolbox"
});

document.addEventListener("DOMContentLoaded", () => {
  const actions = document.querySelector(".start-actions");
  if (!actions || document.querySelector("#toolboxButton")) return;
  const link = document.createElement("a");
  link.id = "toolboxButton";
  link.href = "toolbox.html";
  link.className = "secondary-btn";
  link.textContent = "MARINER TOOLBOX'I AÇ";
  link.style.textDecoration = "none";
  link.style.textAlign = "center";
  link.style.display = "grid";
  link.style.placeItems = "center";
  actions.appendChild(link);
});
