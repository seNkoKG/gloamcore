(() => {
  "use strict";

  const REPOSITORY = "seNkoKG/gloamcore";
  const INSTALLER_URL = `https://github.com/${REPOSITORY}/releases/latest/download/GloamCore-Setup-x64.exe`;
  const FALLBACK_VERSION = "2.8.0";

  const header = document.querySelector("[data-header]");
  const nav = document.querySelector("[data-nav]");
  const navToggle = document.querySelector("[data-nav-toggle]");

  const syncHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 18);
  syncHeader();
  window.addEventListener("scroll", syncHeader, { passive: true });

  if (nav && navToggle) {
    const closeNav = () => {
      nav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    };

    navToggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", String(open));
    });
    nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeNav));
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeNav();
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 760) closeNav();
    });
  }

  const gallery = document.querySelector("[data-gallery]");
  if (gallery) {
    const tabs = [...gallery.querySelectorAll("[data-gallery-tab]")];
    const panels = [...gallery.querySelectorAll("[data-gallery-panel]")];

    const selectTab = (selected, focus = false) => {
      const key = selected.dataset.galleryTab;
      tabs.forEach((tab) => {
        const active = tab === selected;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.galleryPanel !== key;
      });
      if (focus) selected.focus();
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectTab(tab));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        selectTab(tabs[next], true);
      });
    });
  }

  const copyButton = document.querySelector("[data-copy-download]");
  const copyStatus = document.querySelector("[data-copy-status]");
  copyButton?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(INSTALLER_URL);
      if (copyStatus) copyStatus.textContent = "Installer link copied.";
    } catch {
      if (copyStatus) copyStatus.textContent = "Copy failed. Open the release page instead.";
    }
  });

  const applyRelease = (version, releaseUrl) => {
    document.querySelectorAll("[data-version]").forEach((node) => {
      node.textContent = version;
    });
    document.querySelectorAll("[data-version-chip]").forEach((node) => {
      node.textContent = `v${version}`;
    });
    document.querySelectorAll("[data-release-link]").forEach((link) => {
      link.href = releaseUrl;
    });
    document.querySelectorAll("[data-download-portable]").forEach((link) => {
      link.href = `https://github.com/${REPOSITORY}/releases/download/v${version}/GloamCore-Portable-${version}-x64.exe`;
    });
  };

  applyRelease(FALLBACK_VERSION, `https://github.com/${REPOSITORY}/releases/latest`);

  const controller = new AbortController();
  const releaseTimeout = window.setTimeout(() => controller.abort(), 4000);
  fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: controller.signal,
  })
    .then((response) => {
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      return response.json();
    })
    .then((release) => {
      const version = typeof release.tag_name === "string"
        ? release.tag_name.replace(/^v/, "")
        : FALLBACK_VERSION;
      const releaseUrl = typeof release.html_url === "string"
        ? release.html_url
        : `https://github.com/${REPOSITORY}/releases/latest`;
      if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
        applyRelease(version, releaseUrl);
      }
    })
    .catch(() => undefined)
    .finally(() => window.clearTimeout(releaseTimeout));

  document.querySelectorAll("[data-download-installer]").forEach((link) => {
    link.href = INSTALLER_URL;
  });

  const year = document.querySelector("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());
})();
