// Adds a shadow/border to the navbar once the page is scrolled.
function addNavbarScrollShadow() {
  var $navbar = $(".site-navbar");

  $(window).on("scroll", function () {
    if ($(window).scrollTop() > 12) {
      $navbar.addClass("is-scrolled");
    } else {
      $navbar.removeClass("is-scrolled");
    }
  });
}

var SIGNED_IN_HOME_PAGE = "markets.html";

// Hides the marketing "Home" link for signed-in users and points the logo at Markets instead.
function toggleHomeNavLink(isSignedIn) {
  $(".site-navbar .nav-link[href='index.html']").closest(".nav-item").toggleClass("d-none", isSignedIn);
  $(".site-navbar .navbar-brand").attr("href", isSignedIn ? SIGNED_IN_HOME_PAGE : "index.html");
}

// Signed-out visitors see only the "Get Started" CTA, so the page links are hidden for them.
function toggleNavPageLinks(isSignedIn) {
  $(".site-navbar .nav-link").closest(".nav-item").toggleClass("d-none", !isSignedIn);
}

var KYC_COMPLETED_STORAGE_KEY = "beyondly_kyc_completed";

// Remembers KYC completion so the next page load can hide KYC links without a flicker.
function rememberKycCompleted(isCompleted) {
  try {
    if (isCompleted) localStorage.setItem(KYC_COMPLETED_STORAGE_KEY, "1");
    else localStorage.removeItem(KYC_COMPLETED_STORAGE_KEY);
  } catch (error) {
    // Storage unavailable: links are still corrected once the profile loads.
  }
}

function isKycCompletedRemembered() {
  try {
    return localStorage.getItem(KYC_COMPLETED_STORAGE_KEY) === "1";
  } catch (error) {
    return false;
  }
}

// Hides KYC links (navbar and footer) once the user's KYC is complete.
function toggleKycLinks(isCompleted) {
  $(".site-navbar .nav-link[href='kyc.html']").closest(".nav-item").toggleClass("d-none", isCompleted);
  $(".site-footer a[href='kyc.html']").toggleClass("d-none", isCompleted);
  $("#navAuthButton").filter("[href='kyc.html'], [href='portfolio.html']")
    .attr("href", isCompleted ? "portfolio.html" : "kyc.html");
}

var STOCK_PAGE_URL = "stock.html?symbol=";

function openStockPage(symbol) {
  window.location.href = STOCK_PAGE_URL + encodeURIComponent(symbol.trim().toUpperCase());
}

// The search API needs a signed-in user, so the box only shows after login.
function toggleNavSearch(isSignedIn) {
  $("#navSearchItem").toggleClass("d-none", !isSignedIn);
}

// Symbol suggestions in the navbar; picking one (or pressing Enter) opens its stock page.
function bindNavSearch() {
  if (!$("#navSearchForm").length || typeof SymbolAutocomplete === "undefined") return;
  new SymbolAutocomplete("#navSearchInput", function (input, suggestion) {
    openStockPage(suggestion.symbol);
  }).bind($("#navSearchForm"));
  $("#navSearchForm").on("submit", function (event) {
    event.preventDefault();
    var typedSymbol = $("#navSearchInput").val().trim();
    if (typedSymbol) openStockPage(typedSymbol);
  });
  bindNavSearchShortcut();
}

// "/" focuses the navbar search unless the user is already typing somewhere.
function bindNavSearchShortcut() {
  $(document).on("keydown", function (event) {
    var isTyping = $(event.target).is("input, textarea, select, [contenteditable]");
    if (event.key !== "/" || isTyping || $("#navSearchItem").hasClass("d-none")) return;
    event.preventDefault();
    $("#navSearchInput").trigger("focus");
  });
}

// Swaps the navbar's "Get Started" button for the signed-in user's name and a Sign Out link.
function showSignedInNavState(profile) {
  var displayName = (profile.name || profile.phone_number || "Account").split(" ")[0];

  $("#navAuthButton").text(displayName).attr("href", "kyc.html");
  $("#navSignOutLink").removeClass("d-none");
  toggleNavPageLinks(true);
  toggleHomeNavLink(true);
  toggleNavSearch(true);
  rememberKycCompleted(!!profile.kyc_completed);
  toggleKycLinks(!!profile.kyc_completed);
}

// Reverts the navbar to its signed-out "Get Started" state.
function showSignedOutNavState() {
  $("#navAuthButton").text("Get Started").attr("href", "get-started.html");
  $("#navSignOutLink").addClass("d-none");
  toggleHomeNavLink(false);
  toggleNavSearch(false);
  rememberKycCompleted(false);
  toggleKycLinks(false);
  toggleNavPageLinks(false);
}

// Clears the stored token and returns the navbar to its signed-out state.
function bindNavSignOut() {
  $("#navSignOutLink").on("click", function (event) {
    event.preventDefault();
    clearStoredAccessToken();
    showSignedOutNavState();
  });
}

// Reflects the current sign-in state in the navbar, confirming the token is still valid.
function updateNavbarAuthState() {
  if (!isUserSignedIn()) {
    showSignedOutNavState();
    return;
  }

  toggleNavSearch(true);
  toggleHomeNavLink(true); // hide right away; reverted below if the token turns out invalid
  toggleKycLinks(isKycCompletedRemembered());
  callBeyondlyApi("GET", "/user/profile/")
    .done(showSignedInNavState)
    .fail(showSignedOutNavState);
}

$(function () {
  addNavbarScrollShadow();
  bindNavSignOut();
  bindNavSearch();
  updateNavbarAuthState();
});
