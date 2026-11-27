// Light / dark theme. Loaded in <head> (before the page paints) so there is no
// flash of the wrong theme. Uses the saved choice, else the OS preference.
// Fires "beyondly:themechange" on document when the theme changes.
var BEYONDLY_THEME_STORAGE_KEY = "beyondly_theme";

class ThemePreference {
  static saved() {
    try {
      var value = localStorage.getItem(BEYONDLY_THEME_STORAGE_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (error) {
      return null;
    }
  }

  static save(theme) {
    try {
      localStorage.setItem(BEYONDLY_THEME_STORAGE_KEY, theme);
    } catch (error) {
      // Storage unavailable: the choice lasts for this page only.
    }
  }

  static systemQuery() {
    return window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  }

  static system() {
    var query = ThemePreference.systemQuery();
    return query && query.matches ? "light" : "dark";
  }
}

class ThemeManager {
  static current() {
    return document.documentElement.getAttribute("data-theme") || "dark";
  }

  // Sets the theme on <html> for our CSS and for Bootstrap's own components.
  static apply(theme) {
    var root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-bs-theme", theme);
    ThemeManager.syncToggleButtons(theme);
    document.dispatchEvent(new CustomEvent("beyondly:themechange", { detail: { theme: theme } }));
  }

  static toggle() {
    var nextTheme = ThemeManager.current() === "dark" ? "light" : "dark";
    ThemePreference.save(nextTheme);
    ThemeManager.applyWithTransition(nextTheme);
  }

  // Fades colours only for user-initiated switches, never on first paint.
  static applyWithTransition(theme) {
    var root = document.documentElement;
    root.classList.add("theme-transition");
    ThemeManager.apply(theme);
    setTimeout(function () { root.classList.remove("theme-transition"); }, 300);
  }

  static syncToggleButtons(theme) {
    var label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.querySelector("i").className = theme === "dark" ? "bi bi-sun" : "bi bi-moon-stars";
    });
  }

  static bindToggleButtons() {
    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      button.addEventListener("click", ThemeManager.toggle);
    });
    ThemeManager.syncToggleButtons(ThemeManager.current());
  }

  // Follows OS changes until the user picks a theme themselves.
  static followSystemChanges() {
    var query = ThemePreference.systemQuery();
    if (!query || !query.addEventListener) return;
    query.addEventListener("change", function () {
      if (!ThemePreference.saved()) ThemeManager.applyWithTransition(ThemePreference.system());
    });
  }
}

ThemeManager.apply(ThemePreference.saved() || ThemePreference.system());
ThemeManager.followSystemChanges();
document.addEventListener("DOMContentLoaded", ThemeManager.bindToggleButtons);
