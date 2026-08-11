(() => {
  "use strict";

  const REPOSITORY = "seNkoKG/gloamcore";
  const RELEASE_URL = "https://github.com/" + REPOSITORY + "/releases/latest";
  const INSTALLER_URL = RELEASE_URL + "/download/GloamCore-Setup-x64.exe";
  const SUPPORT_URL = "";

  const header = document.querySelector("[data-header]");
  const nav = document.querySelector("[data-nav]");
  const navToggle = document.querySelector("[data-nav-toggle]");

  const syncHeader = () => {
    header?.classList.toggle("is-scrolled", window.scrollY > 16);
  };

  syncHeader();
  window.addEventListener("scroll", syncHeader, { passive: true });

  if (nav && navToggle) {
    const closeNav = (returnFocus = false) => {
      nav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
      if (returnFocus) navToggle.focus();
    };

    navToggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", String(open));
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => closeNav());
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        closeNav(true);
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 920) closeNav();
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

    gallery.classList.add("is-enhanced");
    selectTab(tabs.find((tab) => tab.getAttribute("aria-selected") === "true") || tabs[0]);

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectTab(tab));
      tab.addEventListener("keydown", (event) => {
        const previousKeys = ["ArrowLeft", "ArrowUp"];
        const nextKeys = ["ArrowRight", "ArrowDown"];
        if (![...previousKeys, ...nextKeys, "Home", "End"].includes(event.key)) return;

        event.preventDefault();
        let next = index;
        if (previousKeys.includes(event.key)) next = (index - 1 + tabs.length) % tabs.length;
        if (nextKeys.includes(event.key)) next = (index + 1) % tabs.length;
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

  const applyRelease = (version, releaseUrl, directPortable = false) => {
    document.querySelectorAll("[data-version-chip]").forEach((node) => {
      node.textContent = "v" + version;
    });

    document.querySelectorAll("[data-version-label]").forEach((node) => {
      node.textContent = "v" + version;
    });

    document.querySelectorAll("[data-release-link]").forEach((link) => {
      link.href = releaseUrl;
    });

    if (directPortable) {
      document.querySelectorAll("[data-download-portable]").forEach((link) => {
        link.href = "https://github.com/" + REPOSITORY + "/releases/download/v" + version + "/GloamCore-Portable-" + version + "-x64.exe";
      });
    }
  };

  const controller = new AbortController();
  const releaseTimeout = window.setTimeout(() => controller.abort(), 4000);

  fetch("https://api.github.com/repos/" + REPOSITORY + "/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
    signal: controller.signal,
  })
    .then((response) => {
      if (!response.ok) throw new Error("GitHub returned " + response.status);
      return response.json();
    })
    .then((release) => {
      const version = typeof release.tag_name === "string"
        ? release.tag_name.replace(/^v/, "")
        : "";
      const releaseUrl = typeof release.html_url === "string"
        ? release.html_url
        : RELEASE_URL;

      if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
        applyRelease(version, releaseUrl, true);
      }
    })
    .catch(() => undefined)
    .finally(() => window.clearTimeout(releaseTimeout));

  document.querySelectorAll("[data-download-installer]").forEach((link) => {
    link.href = INSTALLER_URL;
  });

  const parseSupportUrl = () => {
    if (!SUPPORT_URL) return null;
    try {
      const url = new URL(SUPPORT_URL);
      return url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  };

  const supportUrl = parseSupportUrl();
  if (supportUrl) {
    document.querySelectorAll("[data-support-link]").forEach((link) => {
      link.href = supportUrl.href;
    });
    document.querySelectorAll("[data-support-section], [data-support-nav]").forEach((node) => {
      node.hidden = false;
    });
    document.querySelectorAll("[data-support-nav]").forEach((link) => {
      link.href = "#support";
    });
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealItems = [...document.querySelectorAll("[data-reveal]")];

  if (!reduceMotion && "IntersectionObserver" in window && revealItems.length) {
    document.body.classList.add("reveal-ready");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  }

  const year = document.querySelector("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());
})();
