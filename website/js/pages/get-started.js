var PHONE_NUMBER_PATTERN = /^\+91[6-9]\d{9}$/;
var PAN_NUMBER_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/;
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

var enteredPhoneNumber = "";
var enteredEmail = "";

var ALL_SIGNUP_PANELS = [
  "#phoneEntryPanel",
  "#phoneOtpPanel",
  "#emailEntryPanel",
  "#emailOtpPanel",
  "#profilePanel",
  "#signupDonePanel",
  "#pinNotSupportedPanel",
];

// Shows one signup panel and hides all the others.
function showSignupPanel(panelSelector) {
  ALL_SIGNUP_PANELS.forEach(function (selector) {
    $(selector).toggleClass("d-none", selector !== panelSelector);
  });
}

// Marks stepper circles 1..stepNumber as done/active based on progress so far.
function setSignupStepperProgress(stepNumber) {
  $(".stepper-step").each(function () {
    var thisStep = parseInt($(this).data("step"), 10);
    $(this).removeClass("is-active is-done");

    if (thisStep < stepNumber) {
      $(this).addClass("is-done");
    } else if (thisStep === stepNumber) {
      $(this).addClass("is-active");
    }
  });
}

// Displays an API/validation error above the form.
function showSignupError(message) {
  $("#signupErrorAlert").text(message).removeClass("d-none");
}

function hideSignupError() {
  $("#signupErrorAlert").addClass("d-none");
}

// Masks a phone number, keeping only the last 4 digits visible.
function maskPhoneNumber(phone) {
  return "•••• " + phone.slice(-4);
}

// Masks an email address, keeping the first letter and the domain visible.
function maskEmailAddress(email) {
  var parts = email.split("@");
  return parts.length === 2 ? parts[0].charAt(0) + "•••@" + parts[1] : email;
}

// Routes the user to the right panel after a phone or email OTP is verified.
function handleOtpVerified(accessToken, redirectTo) {
  setStoredAccessToken(accessToken);
  hideSignupError();

  if (redirectTo === "email_registration") {
    setSignupStepperProgress(2);
    showSignupPanel("#emailEntryPanel");
  } else if (redirectTo === "pan_registration") {
    setSignupStepperProgress(3);
    showSignupPanel("#profilePanel");
  } else if (redirectTo === "homepage") {
    window.location.href = "markets.html";
  } else if (redirectTo === "pin") {
    showSignupPanel("#pinNotSupportedPanel");
  }
}

// Step 1a: send an OTP to the entered phone number.
function bindSendPhoneOtp() {
  $("#sendPhoneOtpBtn").on("click", function () {
    var phoneNumber = $("#signupPhone").val().trim();
    $("#signupPhoneError").toggle(!PHONE_NUMBER_PATTERN.test(phoneNumber));
    if (!PHONE_NUMBER_PATTERN.test(phoneNumber)) {
      return;
    }

    hideSignupError();
    var $btn = $(this).prop("disabled", true);

    callBeyondlyApi("POST", "/user/otp/generate/", { body: { phone_number: phoneNumber } })
      .done(function () {
        enteredPhoneNumber = phoneNumber;
        $("#maskedPhoneDisplay").text(maskPhoneNumber(phoneNumber));
        showSignupPanel("#phoneOtpPanel");
      })
      .fail(function (jqXHR) {
        showSignupError(extractApiErrorMessage(jqXHR));
      })
      .always(function () {
        $btn.prop("disabled", false);
      });
  });
}

// Step 1b: verify the phone OTP.
function bindVerifyPhoneOtp() {
  $("#verifyPhoneOtpBtn").on("click", function () {
    var otp = $("#phoneOtpInput").val().trim();
    $("#phoneOtpError").toggle(!otp);
    if (!otp) {
      return;
    }

    hideSignupError();
    var $btn = $(this).prop("disabled", true);

    callBeyondlyApi("POST", "/user/otp/verify/", { body: { phone_number: enteredPhoneNumber, otp: otp } })
      .done(function (response) {
        handleOtpVerified(response.access_token, response.redirect_to);
      })
      .fail(function (jqXHR) {
        showSignupError(extractApiErrorMessage(jqXHR));
      })
      .always(function () {
        $btn.prop("disabled", false);
      });
  });
}

// Step 2a: send an OTP to the entered email address.
function bindSendEmailOtp() {
  $("#sendEmailOtpBtn").on("click", function () {
    var email = $("#signupEmail").val().trim();
    $("#signupEmailError").toggle(!EMAIL_PATTERN.test(email));
    if (!EMAIL_PATTERN.test(email)) {
      return;
    }

    hideSignupError();
    var $btn = $(this).prop("disabled", true);

    callBeyondlyApi("POST", "/user/email-otp/generate/", { body: { email: email } })
      .done(function () {
        enteredEmail = email;
        $("#maskedEmailDisplay").text(maskEmailAddress(email));
        showSignupPanel("#emailOtpPanel");
      })
      .fail(function (jqXHR) {
        showSignupError(extractApiErrorMessage(jqXHR));
      })
      .always(function () {
        $btn.prop("disabled", false);
      });
  });
}

// Step 2b: verify the email OTP.
function bindVerifyEmailOtp() {
  $("#verifyEmailOtpBtn").on("click", function () {
    var otp = $("#emailOtpInput").val().trim();
    $("#emailOtpError").toggle(!otp);
    if (!otp) {
      return;
    }

    hideSignupError();
    var $btn = $(this).prop("disabled", true);

    callBeyondlyApi("POST", "/user/email-otp/verify/", { body: { otp: otp } })
      .done(function (response) {
        handleOtpVerified(response.access_token, response.redirect_to);
      })
      .fail(function (jqXHR) {
        showSignupError(extractApiErrorMessage(jqXHR));
      })
      .always(function () {
        $btn.prop("disabled", false);
      });
  });
}

// Temporarily disables a resend button to simulate a resend cooldown.
function startResendCooldown(buttonSelector, seconds) {
  var $button = $(buttonSelector);
  var remainingSeconds = seconds;
  var originalLabel = $button.data("label") || $button.text();
  $button.data("label", originalLabel);
  $button.prop("disabled", true);

  var countdownInterval = setInterval(function () {
    remainingSeconds -= 1;
    $button.text(originalLabel + " (" + remainingSeconds + "s)");

    if (remainingSeconds <= 0) {
      clearInterval(countdownInterval);
      $button.prop("disabled", false).text(originalLabel);
    }
  }, 1000);
}

function bindResendButtons() {
  $("#resendPhoneOtpBtn").on("click", function () {
    $("#sendPhoneOtpBtn").trigger("click");
    startResendCooldown("#resendPhoneOtpBtn", 30);
  });

  $("#resendEmailOtpBtn").on("click", function () {
    $("#sendEmailOtpBtn").trigger("click");
    startResendCooldown("#resendEmailOtpBtn", 30);
  });
}

// Validates the profile form fields and shows inline errors.
function validateProfileForm() {
  var isValid = true;
  var pan = $("#profilePan").val().trim().toUpperCase();

  $("#profilePanError").hide();

  if (!PAN_NUMBER_PATTERN.test(pan)) {
    $("#profilePanError").show();
    isValid = false;
  }

  return isValid;
}

// After registration, starts the KYC application and sends the user straight to
// the broker's DigiLocker flow. Falls back to the "done" panel (with a manual
// link to the KYC page) if the redirect URL isn't ready for any reason.
function startKycAndRedirect() {
  callBeyondlyApi("POST", "/kyc/initiate/", { body: {} })
    .done(function (application) {
      if (application.redirect_url) {
        window.location.href = application.redirect_url;
        return;
      }
      setSignupStepperProgress(4);
      showSignupPanel("#signupDonePanel");
    })
    .fail(function () {
      setSignupStepperProgress(4);
      showSignupPanel("#signupDonePanel");
    });
}

// Step 3: complete registration (provisions the broker account).
function bindProfileFormSubmit() {
  $("#profileForm").on("submit", function (event) {
    event.preventDefault();

    if (!validateProfileForm()) {
      return;
    }

    hideSignupError();
    var body = {
      pan_number: $("#profilePan").val().trim().toUpperCase(),
    };
    var $submitBtn = $(this).find("button[type=submit]").prop("disabled", true);

    callBeyondlyApi("POST", "/user/register/", { body: body })
      .done(function () {
        startKycAndRedirect();
      })
      .fail(function (jqXHR) {
        var message = extractApiErrorMessage(jqXHR);
        if (message.toLowerCase().indexOf("already registered") !== -1) {
          startKycAndRedirect();
        } else {
          showSignupError(message);
        }
      })
      .always(function () {
        $submitBtn.prop("disabled", false);
      });
  });
}

$(function () {
  bindSendPhoneOtp();
  bindVerifyPhoneOtp();
  bindSendEmailOtp();
  bindVerifyEmailOtp();
  bindResendButtons();
  bindProfileFormSubmit();
});
