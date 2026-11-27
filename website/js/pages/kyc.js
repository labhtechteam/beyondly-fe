var KYC_PILL_CLASS_BY_STATUS = {
  initiated: "pill-review",
  pending: "pill-pending",
  verified: "pill-approved",
  rejected: "pill-sell",
  failed: "pill-sell",
};

function showKycError(message) {
  $("#kycErrorAlert").text(message).removeClass("d-none");
}

function hideKycError() {
  $("#kycErrorAlert").addClass("d-none");
}

// Renders a KYC application's status pill, id/timestamp fields, and redirect link.
function renderKycApplication(application) {
  var statusClass = KYC_PILL_CLASS_BY_STATUS[application.status] || "pill-pending";

  $("#kycStatusPill")
    .removeClass("pill-pending pill-review pill-approved pill-sell")
    .addClass(statusClass)
    .text(application.status)
    .removeClass("d-none");

  $("#kycApplicationId").text(application.application_id);
  $("#kycUpdatedAt").text(new Date(application.updated_at).toLocaleString());

  if (application.redirect_url) {
    $("#kycContinueLink").attr("href", application.redirect_url).removeClass("d-none");
  } else {
    $("#kycContinueLink").addClass("d-none");
  }

  $("#kycStartPanel").addClass("d-none");
  $("#kycApplicationPanel").removeClass("d-none");
}

// Starts (or resumes) the user's KYC application, then sends the user straight
// to the broker's DigiLocker flow using the redirect URL the backend returns.
function bindKycStart() {
  $("#kycStartBtn").on("click", function () {
    hideKycError();
    var $btn = $(this).prop("disabled", true).text("Starting...");

    callBeyondlyApi("POST", "/kyc/initiate/", { body: {} })
      .done(function (application) {
        if (application.redirect_url) {
          window.location.href = application.redirect_url;
          return;
        }
        renderKycApplication(application);
        showKycError("Verification link is not ready yet. Please refresh status and try again.");
      })
      .fail(function (jqXHR) {
        showKycError(extractApiErrorMessage(jqXHR));
      })
      .always(function () {
        $btn.prop("disabled", false).text("Start Verification");
      });
  });
}

// Asks the backend for the user's KYC step. It starts DigiLocker or sends
// the user to the KYC form when that is their next step, and otherwise
// shows the application's status.
function loadKycStatus() {
  return callBeyondlyApi("GET", "/kyc/status/").done(function (response) {
    if (response.redirect_to) {
      window.location.href = response.redirect_to;
      return;
    }
    if (response.application) {
      renderKycApplication(response.application);
    }
  });
}

// Re-fetches the latest status for the user's KYC application.
function bindKycRefreshStatus() {
  $("#kycRefreshStatusBtn").on("click", function () {
    hideKycError();
    var $btn = $(this).prop("disabled", true).text("Checking...");

    loadKycStatus()
      .fail(function (jqXHR) {
        showKycError(extractApiErrorMessage(jqXHR));
      })
      .always(function () {
        $btn.prop("disabled", false).text("Refresh Status");
      });
  });
}

$(function () {
  if (!requireSignedInUser()) {
    return;
  }

  bindKycStart();
  bindKycRefreshStatus();
  loadKycStatus().fail(function (jqXHR) {
    showKycError(extractApiErrorMessage(jqXHR));
  });
});
