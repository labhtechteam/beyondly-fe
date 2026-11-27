var kycParts = [];
var currentPartIndex = 0;
var kycPersonalDetails = {};

// Maps a vendor question's system_identifier to one of our saved personal
// detail attributes (collected from PAN verification), so matching fields
// can be prefilled. Checked in order; more specific patterns (father,
// dob, ...) come before the generic "name.first"/"name.last" ones so
// e.g. "applicant.primary.father.name.first" doesn't match "first_name".
// The address/city/pincode/country matchers are scoped to "home" only so
// the same PAN-derived values never leak into the mailing address fields
// (matchPersonalDetailValue excludes any "mailing" identifier outright).
var PERSONAL_DETAIL_MATCHERS = [
  { attribute: "pan_number", pattern: /document\.id\.(national\.)?number$/ },
  { attribute: "aadhaar_number", pattern: /aadhar\.number$/ },
  { attribute: "treaty_country", pattern: /treaty-country$/ },
  { attribute: "country", pattern: /document\.(id|address)\.country$/ },
  { attribute: "father_first_name", pattern: /father\.name\.first$/ },
  { attribute: "father_last_name", pattern: /father\.name\.last$/ },
  { attribute: "father_name", pattern: /father/ },
  { attribute: "citizenship", pattern: /citizenship\.country$/ },
  { attribute: "birth_country", pattern: /birth-country/ },
  // Excludes "birth-country" so it isn't mistaken for the dob field.
  { attribute: "date_of_birth", pattern: /dob|birth(?!-country)/ },
  { attribute: "pincode", pattern: /home\.zip|pincode|pin.?code/ },
  { attribute: "gender", pattern: /gender/ },
  { attribute: "city", pattern: /home\.city/ },
  { attribute: "country", pattern: /home\.country/ },
  { attribute: "state", pattern: /home\.(region|state)/ },
  { attribute: "address", pattern: /home\.line\.1/ },
  { attribute: "address_line_2", pattern: /home\.line\.2/ },
  { attribute: "middle_name", pattern: /middle/ },
  { attribute: "first_name", pattern: /first/ },
  { attribute: "last_name", pattern: /last|surname/ },
];

// Normalizes a date string (vendor PAN data may arrive as DD/MM/YYYY,
// DD-MM-YYYY, or already ISO) into the yyyy-mm-dd shape a native
// <input type="date"> requires, or null if it can't be parsed.
function normalizeDobForDateInput(value) {
  if (!value) {
    return null;
  }
  var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) {
    return iso[1] + "-" + iso[2] + "-" + iso[3];
  }
  var dmy = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(value);
  if (dmy) {
    return dmy[3] + "-" + dmy[2].padStart(2, "0") + "-" + dmy[1].padStart(2, "0");
  }
  return null;
}

// The user's previously submitted answers, { "<question id>": [values] }
// (from /kyc/form/), used ahead of the DigiLocker details when prefilling.
var kycSavedAnswers = {};

function savedAnswerFor(question) {
  var values = kycSavedAnswers[String(question.id)];
  return values && values.length ? values[0] : null;
}

function matchSavedOptionId(question) {
  var saved = savedAnswerFor(question);
  var option = (question.options || []).filter(function (opt) { return opt.system_identifier === saved; })[0];
  return option ? option.id : null;
}

function matchPersonalDetailValue(question) {
  var saved = savedAnswerFor(question);
  if (saved) {
    return saved;
  }
  var identifier = (question.system_identifier || "").toLowerCase();
  if (/mailing/.test(identifier)) {
    return null;
  }
  for (var i = 0; i < PERSONAL_DETAIL_MATCHERS.length; i++) {
    var matcher = PERSONAL_DETAIL_MATCHERS[i];
    if (matcher.pattern.test(identifier) && kycPersonalDetails[matcher.attribute]) {
      var value = kycPersonalDetails[matcher.attribute];
      if (matcher.attribute === "date_of_birth" && question.type_id === QUESTION_TYPE_ID.DATE) {
        return normalizeDobForDateInput(value);
      }
      return value;
    }
  }
  return null;
}

// Gender is answered via a fixed option (e.g. "primary-gender-male"), not
// free text, so it needs its own lookup: normalize the PAN-provided value
// (which may be "M"/"F"/"Male"/"Female") down to "male"/"female" and find
// the option whose identifier ends in that word.
function normalizeGenderValue(value) {
  var first = String(value || "").trim().charAt(0).toLowerCase();
  if (first === "m") return "male";
  if (first === "f") return "female";
  return null;
}

function matchPersonalDetailOptionId(question) {
  var savedOptionId = matchSavedOptionId(question);
  if (savedOptionId) {
    return savedOptionId;
  }
  if (!/gender/.test((question.system_identifier || "").toLowerCase()) || !kycPersonalDetails.gender) {
    return matchYesNoOptionId(question);
  }
  var target = normalizeGenderValue(kycPersonalDetails.gender);
  if (!target) {
    return null;
  }
  var match = (question.options || []).filter(function (option) {
    return (option.system_identifier || "").toLowerCase().indexOf("-" + target) !== -1;
  })[0];
  return match ? match.id : null;
}

// Yes/no questions answered from DigiLocker-derived details, whose value
// is the option's system_identifier itself ("yes" / "no").
var YES_NO_DETAIL_MATCHERS = [
  { attribute: "us_citizen", pattern: /citizenship\.country\.us$/ },
  { attribute: "tax_resident_india", pattern: /fatca\.residence\.country\.in$/ },
];

function matchYesNoOptionId(question) {
  var identifier = question.system_identifier || "";
  var matcher = YES_NO_DETAIL_MATCHERS.filter(function (entry) { return entry.pattern.test(identifier); })[0];
  var target = matcher && kycPersonalDetails[matcher.attribute];
  var option = (question.options || []).filter(function (opt) { return opt.system_identifier === target; })[0];
  return option ? option.id : null;
}

// Vendor questions we never render: mobile/email are already on the
// user's own account record, and get answered server-side (see
// kyc/answers.py::ContactAnswerFiller) instead of asking again here.
var HIDDEN_CONTACT_MATCHERS = [/phone\.mobile$/, /email\.personal$/];

// Custom labels + a fixed render order for the identity/suitability
// questions called out in the product spec. A question not matched by
// any entry here keeps its default (humanized) label and normal vendor
// position, rendered after all of the ones below.
var KYC_FIELD_ORDER = [
  { label: "First Name", test: function (id) { return /name\.first$/.test(id) && !/father/.test(id); } },
  { label: "Last Name", test: function (id) { return /name\.last$/.test(id) && !/father/.test(id); } },
  {
    label: "Father's Name",
    combine: true,
    tests: [
      function (id) { return /father\.name\.first$/.test(id); },
      function (id) { return /father\.name\.last$/.test(id); },
    ],
  },
  { label: "Date of Birth", test: function (id) { return /\bdob\b/.test(id); } },
  { label: "Address", test: function (id) { return /address\.home\.line\.1$/.test(id); } },
  { label: "Zip", test: function (id) { return /address\.home\.zip$/.test(id); } },
  { label: "Birth Country", test: function (id) { return /birth-country/.test(id); } },
  { label: "Investment Objective", test: function (id) { return /investment\.objective$/.test(id); } },
  { label: "Risk Tolerance", test: function (id) { return /risk-tolerance$/.test(id); } },
  { label: "Annual Income", test: function (id) { return /annual-income$/.test(id); } },
];

// Groups a flat list of visible, required questions into the fixed
// KYC_FIELD_ORDER first (relabeled, merging Father's Name into one
// field), then any remaining questions in their normal vendor order.
// Questions the vendor marks as conditional on another question's
// answer (parent_questions) are pulled out and attached to their parent
// as "_dependents", so they can be rendered hidden until answered.
function buildPartQuestions(rawQuestions) {
  var root = rawQuestions.filter(function (q) { return !(q.parent_questions && q.parent_questions.length); });
  var conditional = rawQuestions.filter(function (q) { return q.parent_questions && q.parent_questions.length; });

  // Parents may themselves be conditional (e.g. Foreign TIN depends on
  // the FTIN question, which depends on "U.S. citizen"), so look them up
  // among all questions; nested dependents render inside their parent.
  var questionById = {};
  rawQuestions.forEach(function (q) { questionById[q.id] = q; });

  conditional.forEach(function (dependent) {
    var link = dependent.parent_questions[0];
    var parent = questionById[link.parent_question_id];
    if (!parent) {
      root.push(dependent);
      return;
    }
    parent._dependents = parent._dependents || [];
    parent._dependents.push({ question: dependent, parentOptionId: link.parent_option_id });
  });

  var consumed = {};
  var ordered = [];

  KYC_FIELD_ORDER.forEach(function (entry, orderIndex) {
    var available = root.filter(function (q) { return !consumed[q.id]; });

    if (entry.combine) {
      var parts = entry.tests.map(function (test) {
        return available.filter(function (q) { return test(q.system_identifier || ""); })[0];
      });
      if (parts[0] && parts[1]) {
        parts.forEach(function (q) { consumed[q.id] = true; });
        ordered.push({ id: "combine_" + orderIndex, _combine: parts, _label: entry.label, _order: orderIndex });
      }
      return;
    }

    var match = available.filter(function (q) { return entry.test(q.system_identifier || ""); })[0];
    if (match) {
      consumed[match.id] = true;
      match._label = entry.label;
      match._order = orderIndex;
      ordered.push(match);
    }
  });

  ordered.sort(function (a, b) { return a._order - b._order; });

  var rest = root
    .filter(function (q) { return !consumed[q.id]; })
    .sort(function (a, b) { return a.position - b.position; });

  return ordered.concat(rest);
}

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Vendor question "type_id" -> the expected answer shape, used to pick an
// input control. Types not listed here (e.g. 6: plain text) fall back to
// a plain text input, and types with an "options" array (5, 8, 9, ...)
// are handled separately regardless of type_id. Country code (13) gets
// its own dropdown, built from kycCountryList (see buildCountrySelectHtml).
var QUESTION_TYPE_ID = {
  EMAIL: 2,
  DOCUMENT: 3,
  NUMBER: 4,
  FREE_TEXT_DETAILS: 7,
  COUNTRY: 13,
  DATE: 15,
  PHONE: 16,
};

var TYPE_ID_TO_INPUT_TYPE = {};
TYPE_ID_TO_INPUT_TYPE[QUESTION_TYPE_ID.EMAIL] = "email";
TYPE_ID_TO_INPUT_TYPE[QUESTION_TYPE_ID.NUMBER] = "number";
TYPE_ID_TO_INPUT_TYPE[QUESTION_TYPE_ID.DATE] = "date";
TYPE_ID_TO_INPUT_TYPE[QUESTION_TYPE_ID.PHONE] = "tel";

// The broker's supported countries (fetched once via /kyc/countries/), used
// to populate every country-code dropdown in the form. Each entry looks
// like { code: "IN", alpha3: "IND", name: "India" }.
var kycCountryList = [];

// Resolves a PAN-provided country value (which may be a 2-letter code, a
// 3-letter code, or a full name) to the 2-letter code our dropdowns use.
function resolveCountryCode(value) {
  if (!value) {
    return null;
  }
  var normalized = String(value).trim().toLowerCase();
  var match = kycCountryList.filter(function (country) {
    return (
      country.code.toLowerCase() === normalized ||
      country.alpha3.toLowerCase() === normalized ||
      country.name.toLowerCase() === normalized
    );
  })[0];
  return match ? match.code : null;
}

// Above this many options a dropdown is used instead of radio buttons.
var MAX_RADIO_OPTIONS = 3;

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
    .split("-")
    .join(" ")
    .replace(/\w\S*/g, function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
}

// Flattens a form page's sections into a list of visible, required
// questions (skipping mobile/email), ordered per KYC_FIELD_ORDER.
function visibleQuestionsForPage(page) {
  var raw = [];
  (page.sections || [])
    .slice()
    .sort(function (a, b) { return a.position - b.position; })
    .filter(function (section) { return !section.is_hidden; })
    .forEach(function (section) {
      (section.questions || []).forEach(function (question) {
        if (question.is_hidden || question.is_optional) {
          return;
        }
        var identifier = question.system_identifier || "";
        var isContactField = HIDDEN_CONTACT_MATCHERS.some(function (pattern) { return pattern.test(identifier); });
        if (!isContactField) {
          raw.push(question);
        }
      });
    });

  return buildPartQuestions(raw);
}

// Renders a question whose answer is one of a fixed set of options: a
// checkbox for a single option (e.g. "I agree"), radio buttons for a short
// list (e.g. yes/no), or a dropdown for a longer one.
function buildOptionsFieldHtml(question, fieldId, label, required, selectedOptionId) {
  var options = question.options
    .slice()
    .sort(function (a, b) { return a.position - b.position; });

  if (options.length === 1) {
    var checkedAttr = selectedOptionId === options[0].id ? "checked " : "";
    return (
      '<div class="mb-3 form-check">' +
        '<input class="form-check-input" type="checkbox" id="' + fieldId + '" ' +
          'value="' + options[0].system_identifier + '" data-question-id="' + question.id + '" ' +
          'data-option-id="' + options[0].id + '" ' + checkedAttr + required + " />" +
        '<label class="form-check-label" for="' + fieldId + '">' + label + "</label>" +
      "</div>"
    );
  }

  if (options.length <= MAX_RADIO_OPTIONS) {
    var radiosHtml = options
      .map(function (option, index) {
        var radioId = fieldId + "_" + index;
        var checkedAttr = selectedOptionId === option.id ? "checked " : "";
        return (
          '<div class="form-check">' +
            '<input class="form-check-input" type="radio" name="' + fieldId + '" id="' + radioId + '" ' +
              'value="' + option.system_identifier + '" data-question-id="' + question.id + '" ' +
              'data-option-id="' + option.id + '" ' + checkedAttr + required + " />" +
            '<label class="form-check-label" for="' + radioId + '">' + humanizeIdentifier(option.system_identifier) + "</label>" +
          "</div>"
        );
      })
      .join("");

    return (
      '<div class="mb-3">' +
        '<label class="form-label-custom">' + label + "</label>" +
        radiosHtml +
      "</div>"
    );
  }

  var optionsHtml = options
    .map(function (option) {
      var selectedAttr = selectedOptionId === option.id ? "selected " : "";
      return '<option value="' + option.system_identifier + '" data-option-id="' + option.id + '" ' + selectedAttr + ">" + humanizeIdentifier(option.system_identifier) + "</option>";
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

// Renders a text field that answers two vendor questions at once (e.g.
// Father's Name covers both father.name.first and father.name.last),
// splitting the entered value on the first space when submitted.
function buildCombinedFieldHtml(question) {
  var fieldId = "kycQuestion_" + question.id;
  var ids = question._combine.map(function (q) { return q.id; }).join(",");
  var prefillValue = kycPersonalDetails.father_name || "";

  return (
    '<div class="mb-3">' +
      '<label class="form-label-custom" for="' + fieldId + '">' + question._label + "</label>" +
      '<input type="text" class="form-control form-control-custom" id="' + fieldId + '" ' +
        'data-combine-question-ids="' + ids + '" ' +
        (prefillValue ? 'value="' + escapeHtmlAttr(prefillValue) + '" ' : "") +
        "required />" +
    "</div>"
  );
}

// Wraps a question conditional on another question's answer (e.g. the
// mailing address fields, shown only once "same as home" is answered
// "no") in a container hidden by default; bindKycDependentFieldToggles
// reveals it when the parent question's matching option is selected.
function buildDependentFieldsHtml(parentQuestion) {
  if (!parentQuestion._dependents || !parentQuestion._dependents.length) {
    return "";
  }

  return parentQuestion._dependents
    .map(function (dependent) {
      return (
        '<div class="kyc-dependent-field d-none" data-depends-on="' + parentQuestion.id + '" ' +
          'data-depends-option="' + dependent.parentOptionId + '">' +
          buildQuestionFieldHtml(dependent.question, true) +
        "</div>"
      );
    })
    .join("");
}

// Renders a country-code question (type_id 13) as a dropdown built from
// kycCountryList instead of a free-text input.
function buildCountrySelectHtml(question, fieldId, label, required, prefillValue) {
  var selectedCode = resolveCountryCode(prefillValue);

  var optionsHtml = kycCountryList
    .map(function (country) {
      var selectedAttr = country.code === selectedCode ? "selected " : "";
      return '<option value="' + country.code + '" ' + selectedAttr + ">" + escapeHtmlAttr(country.name) + "</option>";
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

// Builds the label + input markup for one question, choosing the control
// that matches the answer the vendor form expects for it.
function buildQuestionFieldHtml(question, startsHidden) {
  if (question._combine) {
    return buildCombinedFieldHtml(question);
  }

  var fieldId = "kycQuestion_" + question.id;
  var label = question._label || humanizeIdentifier(question.system_identifier);
  // Fields starting out inside a hidden (d-none) dependent container must
  // not carry "required" yet: a hidden required field fails native
  // checkValidity() but can't be focused to report it, and the browser
  // throws "An invalid form control ... is not focusable" and blocks
  // submission entirely. toggleDependentFields() adds/removes this
  // attribute as the container is shown/hidden.
  var required = startsHidden ? "" : "required";
  var prefillValue = matchPersonalDetailValue(question);
  var dependentsHtml = buildDependentFieldsHtml(question);

  if (question.document_type_id) {
    return (
      '<div class="mb-3">' +
        '<label class="form-label-custom">' + label + "</label>" +
        '<p class="text-muted-custom small mb-0"><i class="bi bi-info-circle"></i> Document upload is handled during identity verification and can\'t be edited here.</p>' +
      "</div>" + dependentsHtml
    );
  }

  if (question.options && question.options.length) {
    var selectedOptionId = matchPersonalDetailOptionId(question);
    return buildOptionsFieldHtml(question, fieldId, label, required, selectedOptionId) + dependentsHtml;
  }

  if (question.type_id === QUESTION_TYPE_ID.FREE_TEXT_DETAILS) {
    return (
      '<div class="mb-3">' +
        '<label class="form-label-custom" for="' + fieldId + '">' + label + "</label>" +
        '<textarea class="form-control form-control-custom" id="' + fieldId + '" data-question-id="' + question.id + '" rows="3" ' + required + ">" +
          (prefillValue ? escapeHtmlAttr(prefillValue) : "") +
        "</textarea>" +
      "</div>" + dependentsHtml
    );
  }

  if (question.type_id === QUESTION_TYPE_ID.COUNTRY) {
    return buildCountrySelectHtml(question, fieldId, label, required, prefillValue) + dependentsHtml;
  }

  var inputType = TYPE_ID_TO_INPUT_TYPE[question.type_id] || "text";

  return (
    '<div class="mb-3">' +
      '<label class="form-label-custom" for="' + fieldId + '">' + label + "</label>" +
      '<input type="' + inputType + '" class="form-control form-control-custom" id="' + fieldId + '" data-question-id="' + question.id + '" ' +
        (prefillValue ? 'value="' + escapeHtmlAttr(prefillValue) + '" ' : "") +
        required + " />" +
    "</div>" + dependentsHtml
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

// Reads the answers the user entered for the currently rendered part, keyed
// by question id as expected by the answer submission API.
function collectCurrentPartAnswers() {
  var answers = [];

  $("#kycPartFields [data-combine-question-ids]").each(function () {
    var $field = $(this);
    var value = ($field.val() || "").trim();
    if (!value) {
      return;
    }
    var ids = String($field.data("combine-question-ids")).split(",");
    var spaceIndex = value.indexOf(" ");
    var firstPart = spaceIndex === -1 ? value : value.slice(0, spaceIndex);
    var lastPart = spaceIndex === -1 ? value : value.slice(spaceIndex + 1).trim();
    answers.push({ question_id: parseInt(ids[0], 10), data: firstPart });
    answers.push({ question_id: parseInt(ids[1], 10), data: lastPart || firstPart });
  });

  $("#kycPartFields [data-question-id]").each(function () {
    var $field = $(this);
    if ($field.closest(".kyc-dependent-field.d-none").length) {
      return;
    }
    if ($field.is(":radio, :checkbox") && !$field.is(":checked")) {
      return;
    }
    var value = $field.val();
    if (value) {
      answers.push({ question_id: parseInt($field.data("question-id"), 10), data: value });
    }
  });
  return answers;
}

// Shows/hides a question's dependent fields (see buildDependentFieldsHtml)
// to match whichever option is currently selected for it.
function toggleDependentFields($changedField) {
  var questionId = $changedField.data("question-id");
  if (questionId === undefined) {
    return;
  }

  var selectedOptionId = null;
  if ($changedField.is(":radio")) {
    var $checked = $('#kycPartFields [data-question-id="' + questionId + '"]:checked');
    selectedOptionId = $checked.length ? String($checked.data("option-id")) : null;
  } else if ($changedField.is(":checkbox")) {
    selectedOptionId = $changedField.is(":checked") ? String($changedField.data("option-id")) : null;
  } else if ($changedField.is("select")) {
    var $selected = $changedField.find("option:selected");
    selectedOptionId = $selected.length ? String($selected.data("option-id")) : null;
  }

  $('#kycPartFields [data-depends-on="' + questionId + '"]').each(function () {
    var $container = $(this);
    var matches = selectedOptionId !== null && selectedOptionId === String($container.data("depends-option"));
    $container.toggleClass("d-none", !matches);
    // Only this container's own controls: nested dependents stay hidden
    // (and not required) until their own parent answer reveals them.
    var $controls = $container.find("input, select, textarea").filter(function () {
      return $(this).closest(".kyc-dependent-field")[0] === $container[0];
    });
    if (!matches) {
      // Radios/checkboxes keep their option value; only their selection resets.
      $container.find("input:not(:radio):not(:checkbox), textarea").val("");
      $container.find(":radio, :checkbox").prop("checked", false);
      $container.find("select").val("");
      $controls.prop("required", false);
    } else {
      $controls.prop("required", true);
    }
  });
}

function bindKycDependentFieldToggles() {
  $("#kycPartFields").on("change", "[data-question-id]", function () {
    toggleDependentFields($(this));
  });
}

// Submits the KYC application once the declaration (last part) is saved,
// then runs the broker's compliance checks.
function submitKycApplication() {
  $("#kycFormPanel").addClass("d-none");
  $("#kycComplianceLoading").removeClass("d-none");

  callBeyondlyApi("POST", "/kyc/submit/")
    .done(runKycComplianceCheck)
    .fail(function (jqXHR) {
      $("#kycComplianceLoading").addClass("d-none");
      $("#kycFormPanel").removeClass("d-none");
      showKycFormError(extractApiErrorMessage(jqXHR));
    });
}

// Runs the broker's compliance checks once the application is submitted.
function runKycComplianceCheck() {
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
          submitKycApplication();
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

// Fetches the user's DigiLocker details (PAN + Aadhaar) and the country list, then
// the KYC form. Prefilling proceeds even if the details fetch fails.
function loadKycForm() {
  var detailsRequest = callBeyondlyApi("GET", "/kyc/details/").done(function (response) {
    kycPersonalDetails = response || {};
  });

  var countriesRequest = callBeyondlyApi("GET", "/kyc/countries/").done(function (response) {
    kycCountryList = (response && response.countries) || [];
  });

  $.when(detailsRequest, countriesRequest).always(function () {
    fetchAndRenderKycForm();
  });
}

// Fetches the KYC form and splits it into fillable parts, one per vendor form page.
function fetchAndRenderKycForm() {
  callBeyondlyApi("GET", "/kyc/form/")
    .done(function (response) {
      var pages = ((response.form || {}).form || {}).pages || [];
      kycSavedAnswers = response.saved_answers || {};
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
        submitKycApplication();
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
  bindKycDependentFieldToggles();
  loadKycForm();
});
