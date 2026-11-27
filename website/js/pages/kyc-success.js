var kycParts = [];
var currentPartIndex = 0;

function showKycFormError(message) {
  $("#kycFormErrorAlert").text(message).removeClass("d-none");
}

function hideKycFormError() {
  $("#kycFormErrorAlert").addClass("d-none");
}

// Turns a vendor system_identifier like "applicant.primary.name.first" into a readable label.
function humanizeIdentifier(identifier) {
  return (identifier || "")
    .split(".")
    .join(" ")
    .split("_")
    .join(" ")
    .replace(/\w\S*/g, function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
}

// Flattens a form page's sections into a sorted list of visible, answerable questions.
function visibleQuestionsForPage(page) {
  var questions = [];
  (page.sections || [])
    .slice()
    .sort(function (a, b) { return a.position - b.position; })
    .filter(function (section) { return !section.is_hidden; })
    .forEach(function (section) {
      (section.questions || []).forEach(function (question) {
        if (!question.is_hidden) {
          questions.push(question);
        }
      });
    });

  return questions.sort(function (a, b) { return a.position - b.position; });
}

// Builds the label + input markup for one question.
function buildQuestionFieldHtml(question) {
  var fieldId = "kycQuestion_" + question.id;
  var label = humanizeIdentifier(question.system_identifier);
  var required = question.is_optional ? "" : "required";

  if (question.document_type_id) {
    return (
      '<div class="mb-3">' +
        '<label class="form-label-custom">' + label + "</label>" +
        '<p class="text-muted-custom small mb-0"><i class="bi bi-info-circle"></i> Document upload is handled during identity verification and can\'t be edited here.</p>' +
      "</div>"
    );
  }

  if (question.options && question.options.length) {
    var optionsHtml = question.options
      .slice()
      .sort(function (a, b) { return a.position - b.position; })
      .map(function (option) {
        return '<option value="' + option.system_identifier + '">' + humanizeIdentifier(option.system_identifier) + "</option>";
      })
      .join("");

    return (
      '<div class="mb-3">' +
        '<label class="form-label-custom" for="' + fieldId + '">' + label + "</label>" +
        '<select class="form-select form-select-custom" id="' + fieldId + '" data-question-id="' + question.id + '" ' + required + ">" +
          '<option value="">Select...</option>' +
          optionsHtml +
        "</select>" +
      "</div>"
    );
  }

  return (
    '<div class="mb-3">' +
      '<label class="form-label-custom" for="' + fieldId + '">' + label + "</label>" +
      '<input type="text" class="form-control form-control-custom" id="' + fieldId + '" data-question-id="' + question.id + '" ' + required + " />" +
    "</div>"
  );
}

// Renders the stepper circles for the parts of the form.
function renderKycStepper() {
  var html = kycParts
    .map(function (part, index) {
      var stateClass = index < currentPartIndex ? "is-done" : index === currentPartIndex ? "is-active" : "";
      var circle = index < currentPartIndex ? '<i class="bi bi-check-lg"></i>' : index + 1;
      var line = index < kycParts.length - 1 ? '<div class="stepper-line"></div>' : "";
      return (
        '<div class="stepper-step ' + stateClass + '" data-step="' + index + '">' +
          '<div class="stepper-circle">' + circle + "</div>" +
          '<span class="d-none d-sm-inline">Part ' + (index + 1) + "</span>" +
        "</div>" + line
      );
    })
    .join("");

  $("#kycStepper").html(html);
}

// Renders the fields for the current part of the form.
function renderCurrentKycPart() {
  var part = kycParts[currentPartIndex];
  $("#kycPartTitle").text("Part " + (currentPartIndex + 1) + " of " + kycParts.length);
  $("#kycPartFields").html(part.questions.map(buildQuestionFieldHtml).join(""));
  $("#kycPartBackBtn").toggleClass("d-none", currentPartIndex === 0);
  $("#kycPartNextBtn").text(currentPartIndex === kycParts.length - 1 ? "Submit & Continue" : "Next");
  renderKycStepper();
}

// Reads the answers the user entered for the currently rendered part.
function collectCurrentPartAnswers() {
  var answers = [];
  $("#kycPartFields [data-question-id]").each(function () {
    var value = $(this).val();
    if (value) {
      answers.push({ question_id: parseInt($(this).data("question-id"), 10), data: value });
    }
  });
  return answers;
}

// Runs the broker's compliance checks once every part has been submitted.
function runKycComplianceCheck() {
  $("#kycFormPanel").addClass("d-none");
  $("#kycComplianceLoading").removeClass("d-none");

  callBeyondlyApi("POST", "/kyc/compliance/")
    .done(function (application) {
      $("#kycComplianceLoading").addClass("d-none");
      $("#kycDoneMessage").text(
        "Your details have been sent for compliance review. Current status: " + application.status + "."
      );
      $("#kycDonePanel").removeClass("d-none");
    })
    .fail(function (jqXHR) {
      $("#kycComplianceLoading").addClass("d-none");
      $("#kycFormPanel").removeClass("d-none");
      showKycFormError(extractApiErrorMessage(jqXHR));
    });
}

// Submits the current part's answers, then advances to the next part or finishes up.
function bindKycPartFormSubmit() {
  $("#kycPartForm").on("submit", function (event) {
    event.preventDefault();

    var formEl = this;
    if (!formEl.checkValidity()) {
      formEl.reportValidity();
      return;
    }

    hideKycFormError();
    var $btn = $("#kycPartNextBtn").prop("disabled", true);
    var answers = collectCurrentPartAnswers();

    callBeyondlyApi("POST", "/kyc/answer/", { body: { answers: answers } })
      .done(function () {
        if (currentPartIndex === kycParts.length - 1) {
          runKycComplianceCheck();
        } else {
          currentPartIndex += 1;
          renderCurrentKycPart();
        }
      })
      .fail(function (jqXHR) {
        showKycFormError(extractApiErrorMessage(jqXHR));
      })
      .always(function () {
        $btn.prop("disabled", false);
      });
  });
}

function bindKycPartBack() {
  $("#kycPartBackBtn").on("click", function () {
    if (currentPartIndex > 0) {
      currentPartIndex -= 1;
      renderCurrentKycPart();
    }
  });
}

// Fetches the KYC form and splits it into fillable parts (one per form page).
function loadKycForm() {
  callBeyondlyApi("GET", "/kyc/form/")
    .done(function (response) {
      var pages = ((response.form || {}).form || {}).pages || [];
      kycParts = pages
        .slice()
        .sort(function (a, b) { return a.position - b.position; })
        .filter(function (page) { return !page.is_hidden; })
        .map(function (page) {
          return { id: page.id, questions: visibleQuestionsForPage(page) };
        })
        .filter(function (part) { return part.questions.length > 0; });

      $("#kycFormLoading").addClass("d-none");

      if (kycParts.length === 0) {
        runKycComplianceCheck();
        return;
      }

      currentPartIndex = 0;
      $("#kycFormPanel").removeClass("d-none");
      renderCurrentKycPart();
    })
    .fail(function (jqXHR) {
      $("#kycFormLoading").addClass("d-none");
      showKycFormError(extractApiErrorMessage(jqXHR));
    });
}

$(function () {
  if (!requireSignedInUser()) {
    return;
  }

  bindKycPartFormSubmit();
  bindKycPartBack();
  loadKycForm();
});
