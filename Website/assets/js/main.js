/* ==========================================================================
   Ninja Lens — Website interactions
   Vanilla JS, progressive enhancement. Safe fallbacks when JS is disabled.
   ========================================================================== */
(function () {
  "use strict";

  // Progressive enhancement gate: interactive styles (reveal, stagger,
  // marquee) only activate when scripting actually runs.
  document.documentElement.classList.add("js");

  var prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  /* ---------- helpers ---------- */
  function lives(fn) {
    try {
      fn();
    } catch (error) {
      if (window.console && console.warn) {
        console.warn("Ninja Lens site:", error);
      }
    }
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(self, args);
      }, wait);
    };
  }

  /* ---------- header scroll state ---------- */
  lives(function () {
    var header = document.querySelector("[data-header]");
    if (!header) return;
    var update = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
  });

  /* ---------- mobile nav ---------- */
  lives(function () {
    var toggle = document.querySelector("[data-nav-toggle]");
    var nav = document.querySelector("[data-nav]");
    if (!toggle || !nav) return;

    var close = function () {
      toggle.setAttribute("aria-expanded", "false");
      nav.classList.remove("is-open");
    };

    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // Close when a link inside the mobile nav is chosen.
    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) close();
    });

    // Close on Escape.
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
    });

    // Close when resizing to desktop width.
    window.addEventListener(
      "resize",
      debounce(function () {
        if (window.innerWidth > 860) close();
      }, 120)
    );
  });

  /* ---------- scroll reveal ---------- */
  lives(function () {
    var items = document.querySelectorAll("[data-reveal]");
    if (!items.length) return;

    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
      items.forEach(function (el) {
        el.classList.add("is-revealed");
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -36px 0px" }
    );

    items.forEach(function (el) {
      observer.observe(el);
    });
  });

  /* ---------- card spotlight (follows cursor) ---------- */
  lives(function () {
    var cards = document.querySelectorAll(".feature, .how-step");
    if (!cards.length) return;
    if (!window.matchMedia("(hover: hover)").matches) return;

    cards.forEach(function (card) {
      card.addEventListener("pointermove", function (event) {
        var rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", event.clientX - rect.left + "px");
        card.style.setProperty("--my", event.clientY - rect.top + "px");
      });
    });
  });

  /* ---------- staggered grid reveal ---------- */
  lives(function () {
    var groups = document.querySelectorAll("[data-stagger]");
    if (!groups.length) return;

    var done = function () {
      groups.forEach(function (group) {
        group.classList.add("is-stagged");
      });
    };
    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
      done();
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-stagged");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -32px 0px" }
    );

    groups.forEach(function (group) {
      observer.observe(group);
    });
  });

  /* ---------- ticker marquee (duplicate list, aria-hidden copy) ---------- */
  lives(function () {
    var ticker = document.querySelector("[data-marquee]");
    if (!ticker) return;
    var track = ticker.closest(".ticker__marquee");

    if (prefersReducedMotion) return;
    var copy = ticker.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    if (track) {
      track.appendChild(copy);
      track.setAttribute("data-dup", "");
    }
  });

  /* ---------- scroll-spy nav highlighting ---------- */
  lives(function () {
    var links = Array.prototype.slice.call(
      document.querySelectorAll(".site-nav__list a")
    );
    if (!links.length || !("IntersectionObserver" in window)) return;

    var sections = links
      .map(function (link) {
        return document.querySelector(link.getAttribute("href"));
      })
      .filter(Boolean);

    var setActive = function (id) {
      links.forEach(function (link) {
        link.classList.toggle(
          "is-active",
          link.getAttribute("href") === "#" + id
        );
      });
    };

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
    );
    sections.forEach(function (section) {
      observer.observe(section);
    });
  });

  /* ---------- back to top ---------- */
  lives(function () {
    var button = document.querySelector("[data-to-top]");
    if (!button) return;

    var update = function () {
      button.classList.toggle("is-visible", window.scrollY > 700);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });

    button.addEventListener("click", function () {
      window.scrollTo({
        top: 0,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    });
  });

  /* ---------- gallery tabs ---------- */
  lives(function () {
    var gallery = document.querySelector("[data-gallery]");
    if (!gallery) return;

    var tabs = gallery.querySelectorAll("[data-gallery-tab]");
    var panels = gallery.querySelectorAll("[data-gallery-panel]");

    function select(key) {
      tabs.forEach(function (tab) {
        var active = tab.getAttribute("data-gallery-tab") === key;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
        if (active) tab.removeAttribute("tabindex");
        else tab.setAttribute("tabindex", "-1");
      });
      panels.forEach(function (panel) {
        panel.hidden = panel.getAttribute("data-gallery-panel") !== key;
      });
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        select(tab.getAttribute("data-gallery-tab"));
      });
    });

    // Arrow-key support within the tablist.
    var focusIndex = 0;
    tabs.forEach(function (tab, index) {
      tab.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        focusIndex =
          event.key === "ArrowRight"
            ? (focusIndex + 1) % tabs.length
            : (focusIndex - 1 + tabs.length) % tabs.length;
        tabs[focusIndex].focus();
        select(tabs[focusIndex].getAttribute("data-gallery-tab"));
      });
      tab.addEventListener("focus", function () {
        focusIndex = index;
      });
    });
  });

  /* ---------- interactive demo ---------- */
  lives(function () {
    var demo = document.querySelector("[data-demo]");
    var mock = document.querySelector("[data-mock]");
    if (!demo || !mock) return;

    var dots = Array.prototype.slice.call(
      demo.querySelectorAll("[data-demo-dot]")
    );
    if (!dots.length) return;

    var items = [
      {
        name: "The Doctor",
        base: "Divination Card",
        price: "18.7",
        league: "Hardcore",
        status: "TRADE LIVE",
        facts: ["ILVL 84", "Q 20%", "6 LINKS"],
        rows: [
          ["6.2 DIVINE", "Headhunter", "24 LISTED"],
          ["18.7 DIVINE", "The Doctor", "4.2k LISTED"],
          ["3.1 DIVINE", "House of Mirrors", "58 LISTED"],
        ],
      },
      {
        name: "Malachai's Loop",
        base: "Iron Circlet",
        price: "38.0",
        league: "Hardcore",
        status: "TRADE LIVE",
        facts: ["ILVL 86", "1.2% CRIT", "REQ 67"],
        rows: [
          ["34.0 chaos", "day 2 seller", "8 LISTED"],
          ["38.0 chaos", "near-rolled", "241 LISTED"],
          ["0.4 divine", "day 1 copy", "12 LISTED"],
        ],
      },
      {
        name: "Awakened Added Chaos Damage",
        base: "Awakened Support (23/19)",
        price: "11.2",
        league: "Hardcore",
        status: "TRADE LIVE",
        facts: ["LEVEL 23", "Q 20%", "23/19"],
        rows: [
          ["10.9 divine", "20/20", "17 LISTED"],
          ["11.2 divine", "23/19", "36 LISTED"],
          ["13.4 divine", "23/20", "9 LISTED"],
        ],
      },
    ];

    var activeIndex =
      dots.findIndex(function (dot) {
        return dot.classList.contains("is-active");
      }) % items.length;
    if (activeIndex < 0) activeIndex = 0;

    var timer = null;

    function render(index, animate) {
      var item = items[index];
      var set = function (selector, value) {
        var el = mock.querySelector(selector);
        if (el) el.textContent = value;
      };
      set("[data-mock-name]", item.name);
      set("[data-mock-base]", item.base);
      set("[data-mock-league]", item.league);
      set("[data-mock-status]", item.status);
      set("[data-mock-number]", item.price);

      var facts = mock.querySelector("[data-mock-facts]");
      if (facts) {
        facts.innerHTML = item.facts
          .map(function (f) {
            return "<b>" + f + "</b>";
          })
          .join("");
      }

      var rows = mock.querySelector("[data-mock-rows]");
      if (rows) {
        rows.innerHTML = item.rows
          .map(function (r) {
            return (
              '<div class="mock__row"><span>' +
              r[0] +
              '</span><span>' +
              r[1] +
              "</span><em>" +
              r[2] +
              "</em></div>"
            );
          })
          .join("");
      }

      if (animate && !prefersReducedMotion) {
        mock.classList.remove("is-swapping");
        // Force reflow so the animation restarts.
        void mock.offsetWidth;
        mock.classList.add("is-swapping");
      }

      dots.forEach(function (dot, i) {
        var active = i === index;
        dot.classList.toggle("is-active", active);
        dot.setAttribute("aria-selected", active ? "true" : "false");
      });
      activeIndex = index;
    }

    function restartTimer() {
      clearInterval(timer);
      if (prefersReducedMotion) return;
      timer = setInterval(function () {
        render((activeIndex + 1) % items.length, true);
      }, 5200);
    }

    dots.forEach(function (dot) {
      dot.addEventListener("click", function () {
        var index = Number(dot.getAttribute("data-demo-dot"));
        render(index, true);
        restartTimer();
      });
    });

    render(activeIndex, false);
    restartTimer();
  });

  /* ---------- copy direct link ---------- */
  lives(function () {
    var buttons = document.querySelectorAll("[data-copy]");
    if (!buttons.length) return;

    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        var target = button.getAttribute("data-copy");
        var label = button.querySelector("[data-copy-label]");
        var done = function (ok) {
          if (!label) return;
          var original = label.textContent;
          if (ok) {
            button.classList.add("is-copied");
            label.textContent =
              button.getAttribute("data-copied") || "Copied!";
            setTimeout(function () {
              button.classList.remove("is-copied");
              label.textContent = original;
            }, 1800);
          }
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(target).then(
            function () {
              done(true);
            },
            function () {
              done(false);
            }
          );
        } else {
          // Legacy fallback.
          try {
            var textarea = document.createElement("textarea");
            textarea.value = target;
            textarea.setAttribute("readonly", "");
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            var ok = document.execCommand("copy");
            document.body.removeChild(textarea);
            done(ok);
          } catch (error) {
            done(false);
          }
        }
      });
    });
  });

  /* ---------- checksum reveal ---------- */
  lives(function () {
    var toggle = document.querySelector("[data-checksum-toggle]");
    var block = document.querySelector("[data-checksum]");
    if (!toggle || !block) return;

    toggle.addEventListener("click", function () {
      var open = block.hidden;
      block.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  /* ---------- FAQ ---------- */
  lives(function () {
    var faq = document.querySelector("[data-faq]");
    if (!faq) return;
    // Native <details> handles open/close; only close siblings so the page
    // stays tidy when someone opens more than one question at a time.
    faq.addEventListener("toggle", function (event) {
      if (!event.target.open) return;
      Array.prototype.forEach.call(faq.querySelectorAll("details"), function (
        item
      ) {
        if (item !== event.target) item.open = false;
      });
    });
  });

  /* ---------- live version check (progressive enhancement) ---------- */
  lives(function () {
    var versions = document.querySelectorAll("[data-version]");
    var chips = document.querySelectorAll("[data-version-chip]");
    var enabled = navigator.onLine !== false;
    if (!enabled || !versions.length) return;

    var controller =
      window.AbortController && new AbortController();
    var timeout = setTimeout(function () {
      if (controller) controller.abort();
    }, 6000);

    fetch("https://api.github.com/repos/seNkoKG/ninja-lens/releases/latest", {
      signal: controller ? controller.signal : undefined,
      headers: { Accept: "application/vnd.github+json" },
    })
      .then(function (response) {
        if (!response.ok) throw new Error("release request failed");
        return response.json();
      })
      .then(function (release) {
        var version = String(release.tag_name || "")
          .replace(/^v/, "");
        if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error("bad version");
        versions.forEach(function (el) {
          el.textContent = version;
        });
        chips.forEach(function (el) {
          el.textContent = "v" + version;
        });
      })
      .catch(function () {
        /* keep the static fallback version */
      })
      .then(function () {
        clearTimeout(timeout);
      });
  });

  /* ---------- footer year ---------- */
  lives(function () {
    var el = document.querySelector("[data-year]");
    if (el) el.textContent = String(new Date().getFullYear());
  });
})();