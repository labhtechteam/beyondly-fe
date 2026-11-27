// Alternate layout for kyc-form.js (loaded after it): groups each part's
// questions into collapsible sections (1A-1C Personal, 2A-2D Background)
// in the order of the reference screenshots, adds the nominee widget to
// the Nomination Details step (reference 3.png), builds the Agreement and
// Declaration step (reference 4a/4b.png), and swaps the numbered
// stepper for a labelled progress bar. Questions that match no entry in
// KYC_SECTIONED_FIELDS land in the last section of their part.

var KYC_FORM_SECTIONS = [
  { key: "1A", title: "1A - Personal Information (Please add your information as per PAN card)" },
  { key: "1B", title: "1B - Address Information (Please add your information as per Aadhar card)" },
  { key: "1C", title: "1C - Other Details" },
  { key: "2A", title: "Background Details" },
  { key: "2B", title: "KYC Verification" },
  { key: "2C", title: "Claim Of Tax Treaty" },
  { key: "2D", title: "FATCA/CRS" },
];

var KYC_STEP_LABELS = ["Personal Details", "Background Details", "Nomination Details", "Agreement and Declaration"];

var KYC_SECTIONED_FIELDS = [
  { section: "1A", label: "First Name", pattern: /name\.first$/, exclude: /father/ },
  { section: "1A", label: "Middle Name", pattern: /name\.middle$/, exclude: /father/ },
  { section: "1A", label: "Last Name", pattern: /name\.last$/, exclude: /father/ },
  { section: "1A", label: "Father's First Name", pattern: /father\.name\.first$/, half: true },
  { section: "1A", label: "Father's Last Name", pattern: /father\.name\.last$/, half: true },
  { section: "1A", label: "Gender", pattern: /gender/ },
  { section: "1A", label: "Date Of Birth", pattern: /\bdob\b/ },
  { section: "1A", label: "Citizenship", pattern: /citizenship|nationality/, exclude: /\.us$/, half: true },
  { section: "1A", label: "Birth Country", pattern: /birth-country/, half: true },
  { section: "1B", label: "Pincode", pattern: /address\.home\.zip$/, half: true },
  { section: "1B", label: "Country", pattern: /address\.home\.country$/, half: true },
  { section: "1B", label: "State", pattern: /address\.home\.(state|region)$/, half: true },
  { section: "1B", label: "City", pattern: /address\.home\.city$/, half: true },
  { section: "1B", label: "Address Line 1", pattern: /address\.home\.line\.1$/ },
  { section: "1B", label: "Address Line 2", pattern: /address\.home\.line\.2$/ },
  { section: "1B", label: "Address Line 3", pattern: /address\.home\.line\.3$/ },
  { section: "1B", label: "Is your mailing address the same as the previously provided address?", pattern: /same/ },
  { section: "1C", label: "Investment Objective", pattern: /investment\.objective$/ },
  { section: "1C", label: "Investment Experience", pattern: /experience/ },
  { section: "1C", label: "Risk Tolerance", pattern: /risk-tolerance$/ },
  { section: "1C", label: "Annual Income", pattern: /annual-income$/ },
  { section: "1C", label: "Occupation", pattern: /occupation/ },
  { section: "2A", label: "Are you a politically-exposed person?", pattern: /politically-exposed$/ },
  { section: "2A", label: "Have you had any actions/proceedings against you in the past 3 years?", pattern: /past-actions\.exists$/ },
  { section: "2A", label: "Are you liable to pay taxes in any country other than India?", pattern: /jurisdiction\.tax-purpose$/ },
  { section: "2A", label: "Signature", pattern: /document\.signature\.image$/, signature: true },
  { section: "2B", label: "PAN Number", pattern: /document\.id\.number$/ },
  { section: "2B", label: "Aadhar number", pattern: /document\.id\.aadhar\.number$/ },
  // Answered behind the scenes from the DigiLocker PAN/Aadhaar records,
  // like the reference form; shown only if there's no value to send.
  { section: "2B", label: "ID Document Type", pattern: /document\.id\.type$/, autoValue: "pancard" },
  { section: "2B", label: "ID Document Country", pattern: /document\.id\.country$/, auto: true },
  { section: "2B", label: "National ID Number", pattern: /document\.id\.national\.number$/, auto: true },
  { section: "2B", label: "Address Proof Format", pattern: /document\.address\.front\.file-type$/, autoValue: "xml" },
  { section: "2B", label: "Address Proof Country", pattern: /document\.address\.country$/, auto: true },
  { section: "2C", label: "Are you a U.S. citizen?", pattern: /citizenship\.country\.us$/ },
  { section: "2D", label: "Country of tax residence is India", pattern: /fatca\.residence\.country\.in$/ },
];

// Labels for conditional questions, which render nested under their
// parent question rather than through KYC_SECTIONED_FIELDS.
var KYC_DEPENDENT_LABELS = [
  { label: "Please provide details of the actions/proceedings", pattern: /past-actions\.details$/ },
  {
    label: "I certify that the beneficial owner is a resident of the country selected below within the " +
      "meaning of the income tax treaty between the United States and that country.",
    pattern: /w8\.treaty-country$/,
  },
  { label: "Are you legally required to obtain a Foreign TIN in your country?", pattern: /w8\.ftin\.not-required$/ },
  { label: "Foreign TIN", pattern: /w8\.ftin$/ },
  { label: "What is your National ID number (PAN Number)?", pattern: /document\.id\.national\.number$/ },
  { label: "Are you claiming special rates and conditions under the tax treaty?", pattern: /special-rate\.applicable$/ },
  { label: "Treaty article and paragraph", pattern: /special-rate\.paragraph$/ },
  { label: "Withholding rate (%)", pattern: /special-rate\.rate$/ },
  { label: "Type of income", pattern: /special-rate\.income-type$/ },
  { label: "Reason for claiming the special rate", pattern: /special-rate\.explanation$/ },
  { label: "Country of tax residence", pattern: /multiple-countries\.1\.country$/ },
  { label: "Tax Identification Number", pattern: /multiple-countries\.1\.tin$/ },
  { label: "TIN issuing country", pattern: /multiple-countries\.1\.tin\.country$/ },
];

// Typed or uploaded signature for the signature document question. It is
// uploaded to /kyc/signature/ as an image (a typed one is drawn onto a
// canvas first) before the step's answers are saved.
class KycSignatureField {
  constructor() {
    this.mode = "type";
    this.uploaded = false;
  }

  buildHtml(question) {
    this.uploaded = false;
    return (
      '<div class="kyc-signature mb-3">' +
        '<span class="kyc-signature-legend">Signature *</span>' +
        '<div class="d-flex gap-2 mb-3">' +
          this.buildModeButtonHtml("type", "Type Signature") +
          this.buildModeButtonHtml("upload", "Upload Signature") +
        "</div>" +
        '<div class="row gx-3 gy-2" data-signature-pane="type">' +
          '<div class="col-md-6"><input type="text" class="form-control form-control-custom" id="kycSignatureText" ' +
            'placeholder="e.g. John Doe" required /></div>' +
          '<div class="col-md-6"><div class="kyc-signature-preview" id="kycSignaturePreview">(Your Signature Here)</div></div>' +
        "</div>" +
        '<div class="d-none" data-signature-pane="upload">' +
          '<input type="file" class="form-control form-control-custom" id="kycSignatureFile" accept="image/*" />' +
        "</div>" +
      "</div>"
    );
  }

  buildModeButtonHtml(mode, text) {
    var styleClass = mode === this.mode ? "btn-primary-custom" : "btn-outline-custom";
    return '<button type="button" class="btn btn-sm ' + styleClass + '" data-signature-mode="' + mode + '">' + text + "</button>";
  }

  switchMode(mode) {
    this.mode = mode;
    this.uploaded = false;
    $("[data-signature-mode]").each(function () {
      var isActive = $(this).data("signature-mode") === mode;
      $(this).toggleClass("btn-primary-custom", isActive).toggleClass("btn-outline-custom", !isActive);
    });
    $("[data-signature-pane]").each(function () {
      $(this).toggleClass("d-none", $(this).data("signature-pane") !== mode);
    });
    $("#kycSignatureText").prop("required", mode === "type");
    $("#kycSignatureFile").prop("required", mode === "upload");
  }

  updatePreview() {
    var typedName = ($("#kycSignatureText").val() || "").trim();
    $("#kycSignaturePreview").text(typedName || "(Your Signature Here)");
  }

  value() {
    if (this.mode === "upload") {
      var fileInput = $("#kycSignatureFile")[0];
      return { mode: "upload", file: fileInput && fileInput.files.length ? fileInput.files[0] : null };
    }
    return { mode: "type", text: ($("#kycSignatureText").val() || "").trim() };
  }

  isRendered() {
    return $("#kycSignatureText").length > 0;
  }

  // Draws the typed name in the preview's script font as a PNG.
  typedSignatureBlob(text) {
    var canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 150;
    var context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000000";
    context.font = '56px "Dancing Script", cursive';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 40);
    return new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
  }

  signatureBlob() {
    var value = this.value();
    if (value.mode === "upload") {
      return Promise.resolve(value.file);
    }
    return this.typedSignatureBlob(value.text);
  }

  sendSignature(blob) {
    var formData = new FormData();
    formData.append("signature", blob, blob.name || "signature.png");
    return callBeyondlyApi("POST", "/kyc/signature/", { formData: formData });
  }

  // Runs before kyc-form.js's submit handler (capture phase): holds the
  // submit until the signature is uploaded, then submits the step again.
  uploadBeforeSubmit(event) {
    if (!this.isRendered() || this.uploaded || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    var formEl = event.target;
    if (!formEl.checkValidity()) {
      formEl.reportValidity();
      return;
    }
    this.upload(formEl);
  }

  upload(formEl) {
    var self = this;
    hideKycFormError();
    var $btn = $("#kycPartNextBtn").prop("disabled", true);
    this.signatureBlob()
      .then(function (blob) { return self.sendSignature(blob); })
      .then(
        function () { self.uploaded = true; $btn.prop("disabled", false); formEl.requestSubmit(); },
        function (jqXHR) { $btn.prop("disabled", false); showKycFormError(extractApiErrorMessage(jqXHR)); }
      );
  }

  bindEvents() {
    var self = this;
    var $fields = $("#kycPartFields");
    $fields.on("click", "[data-signature-mode]", function () { self.switchMode($(this).data("signature-mode")); });
    $fields.on("input", "#kycSignatureText", function () { self.updatePreview(); self.uploaded = false; });
    $fields.on("change", "#kycSignatureFile", function () { self.uploaded = false; });
    document.getElementById("kycPartForm").addEventListener("submit", this.uploadBeforeSubmit.bind(this), true);
  }
}

var KYC_NOMINATION_STEP_LABEL = "Nomination Details";

var KYC_NOMINATION_STATEMENT =
  "I/We wish to make a nomination (as per details given below) and do hereby nominate the following " +
  "person(s) who shall receive all the assets held in my / our account in the event of my / our death.";

// Vendor questions the nomination widget answers, by system_identifier.
// Nomination-page questions matching none of these render as normal
// fields below the widget. The transfer-on-death opt-in is required by
// the vendor but not shown; it is always answered "no".
var KYC_NOMINEE_QUESTION_PATTERNS = {
  todOptIn: /^application\.tod\.opt-in$/,
  optIn: /nominat\w*\.(exists|opt-in|opt|wish|applicable)$|nomination$/,
  name: /nominee.*name/,
  relationship: /nominee.*relation/,
  share: /nominee.*(share|percent|allocation)/,
};

// Picks out the vendor questions a step widget answers itself, by
// system_identifier pattern (conditional questions included). Each
// question goes to the first key whose pattern matches it.
class KycQuestionMatcher {
  constructor(patterns) {
    this.patterns = patterns;
    this.matches = {};
  }

  flattenQuestions(questions) {
    return questions.reduce(function (all, question) {
      var dependents = (question._dependents || []).map(function (dependent) { return dependent.question; });
      return all.concat([question], this.flattenQuestions(dependents));
    }.bind(this), []);
  }

  // Remembers the matching questions per key and returns the part's other
  // questions, which still render as normal fields.
  claim(questions) {
    var allQuestions = this.flattenQuestions(questions);
    this.matches = {};
    Object.keys(this.patterns).forEach(function (key) {
      var pattern = this.patterns[key];
      this.matches[key] = allQuestions.filter(function (question) {
        return this.isUnclaimed(question) && pattern.test(question.system_identifier || "");
      }, this);
    }, this);
    return questions.filter(this.isUnclaimed, this);
  }

  isUnclaimed(question) {
    return !Object.keys(this.matches).some(function (key) {
      return this.matches[key].some(function (claimed) { return claimed.id === question.id; });
    }, this);
  }

  first(key) {
    return this.all(key)[0];
  }

  all(key) {
    return this.matches[key] || [];
  }
}

// The Nomination Details step, laid out like the reference screenshot: a
// yes/no opt-in, then nominees added one at a time (name, relationship,
// share %) whose shares must total 100%. Nominees stay on the page across
// Back/Next and are sent as answers to the matching vendor questions.
class KycNominationField {
  constructor(patterns) {
    this.matcher = new KycQuestionMatcher(patterns);
    this.choice = null;
    this.nominees = [];
  }

  claimVendorQuestions(questions) {
    return this.matcher.claim(questions);
  }

  afterRender() {
    this.renderNominees();
  }

  buildHtml(otherQuestionsHtml) {
    return (
      '<div class="kyc-section">' +
        '<button type="button" class="kyc-section-toggle" data-bs-toggle="collapse" ' +
          'data-bs-target="#kycSection_nomination" aria-expanded="true">' +
          '<span>Nomination Details</span><i class="bi bi-dash-square"></i><i class="bi bi-plus-square"></i>' +
        "</button>" +
        '<div class="collapse show" id="kycSection_nomination"><div class="kyc-section-body">' +
          '<p class="kyc-nomination-statement">' + KYC_NOMINATION_STATEMENT + " *</p>" +
          this.buildChoiceHtml() +
          '<div id="kycNomineeEditor" class="mb-3' + (this.choice === "yes" ? "" : " d-none") + '"></div>' +
        "</div></div>" +
      "</div>" +
      otherQuestionsHtml
    );
  }

  buildChoiceHtml() {
    return ["yes", "no"].map(function (choice) {
      var radioId = "kycNominationChoice_" + choice;
      var checkedAttr = this.choice === choice ? "checked " : "";
      return (
        '<div class="form-check">' +
          '<input class="form-check-input" type="radio" name="kycNominationChoice" id="' + radioId + '" ' +
            'value="' + choice + '" ' + checkedAttr + "required />" +
          '<label class="form-check-label" for="' + radioId + '">' + (choice === "yes" ? "Yes" : "No") + "</label>" +
        "</div>"
      );
    }, this).join("");
  }

  buildSavedNomineesHtml() {
    return this.nominees.map(function (nominee, index) {
      return (
        '<div class="kyc-nominee-saved">' +
          "<span>" + escapeHtmlAttr(nominee.name) + "</span>" +
          "<span>" + escapeHtmlAttr(nominee.relationship) + "</span>" +
          "<span>" + nominee.share + "%</span>" +
          '<button type="button" class="kyc-nominee-remove" data-remove-nominee="' + index + '" ' +
            'aria-label="Remove nominee"><i class="bi bi-x-lg"></i></button>' +
        "</div>"
      );
    }).join("");
  }

  // The new-nominee row, with the share prefilled to whatever is left.
  buildEntryRowHtml() {
    var remainingShare = 100 - this.totalShare();
    return (
      '<div class="row gx-3 gy-2 mt-1">' +
        '<div class="col-md-4"><input type="text" class="form-control form-control-custom" ' +
          'id="kycNomineeName" placeholder="Nominee Name" /></div>' +
        '<div class="col-md-4"><input type="text" class="form-control form-control-custom" ' +
          'id="kycNomineeRelationship" placeholder="Relationship" /></div>' +
        '<div class="col-md-4"><input type="number" class="form-control form-control-custom" id="kycNomineeShare" ' +
          'placeholder="Share %" min="1" max="' + remainingShare + '" step="1" value="' + remainingShare + '" /></div>' +
        '<div class="col-12"><button type="button" class="btn kyc-nominee-save w-100" id="kycNomineeSaveBtn">Save</button></div>' +
      "</div>"
    );
  }

  buildShareSummaryHtml() {
    if (!this.nominees.length) {
      return "";
    }
    return '<p class="kyc-nominee-total">Total share allocated: ' + this.totalShare() + "% of 100%</p>";
  }

  renderNominees() {
    var entryRowHtml = this.totalShare() < 100 ? this.buildEntryRowHtml() : "";
    $("#kycNomineeEditor")
      .toggleClass("d-none", this.choice !== "yes")
      .html(this.buildSavedNomineesHtml() + entryRowHtml + this.buildShareSummaryHtml());
  }

  totalShare() {
    return this.nominees.reduce(function (total, nominee) { return total + nominee.share; }, 0);
  }

  readEntry() {
    return {
      name: ($("#kycNomineeName").val() || "").trim(),
      relationship: ($("#kycNomineeRelationship").val() || "").trim(),
      share: Number($("#kycNomineeShare").val()),
    };
  }

  entryError(entry) {
    var remainingShare = 100 - this.totalShare();
    if (!entry.name || !entry.relationship) {
      return "Enter the nominee's name and relationship.";
    }
    if (!Number.isInteger(entry.share) || entry.share < 1 || entry.share > remainingShare) {
      return "Nominee share must be a whole number between 1% and " + remainingShare + "%.";
    }
    return null;
  }

  saveEntry() {
    var entry = this.readEntry();
    var error = this.entryError(entry);
    if (error) {
      showKycFormError(error);
      return;
    }
    hideKycFormError();
    this.nominees.push(entry);
    this.renderNominees();
  }

  removeNominee(index) {
    this.nominees.splice(index, 1);
    this.renderNominees();
  }

  selectChoice(choice) {
    this.choice = choice;
    hideKycFormError();
    this.renderNominees();
  }

  isRendered() {
    return $("#kycNomineeEditor").length > 0;
  }

  submissionError() {
    if (this.choice !== "yes" || this.totalShare() === 100) {
      return null;
    }
    return "Add nominees whose shares total 100% (currently " + this.totalShare() + "%).";
  }

  // Runs before kyc-form.js's submit handler (capture phase) and stops it
  // while the nominee shares don't add up.
  guardSubmit(event) {
    var error = this.isRendered() ? this.submissionError() : null;
    if (!error) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    showKycFormError(error);
  }

  optInAnswers() {
    var question = this.matcher.first("optIn");
    if (!question) {
      return [];
    }
    var choice = this.choice;
    var option = (question.options || []).filter(function (opt) {
      return (opt.system_identifier || "").toLowerCase() === choice;
    })[0];
    return [{ question_id: question.id, data: option ? option.system_identifier : choice }];
  }

  todOptOutAnswers() {
    var question = this.matcher.first("todOptIn");
    return question ? [{ question_id: question.id, data: "no" }] : [];
  }

  // A question that takes multiple answers gets one per nominee;
  // otherwise only the first nominee can be sent.
  nomineeAnswers(key) {
    var question = this.matcher.first(key);
    if (!question) {
      return [];
    }
    var nominees = question.has_multiple_answers ? this.nominees : this.nominees.slice(0, 1);
    return nominees.map(function (nominee) { return { question_id: question.id, data: String(nominee[key]) }; });
  }

  buildAnswers() {
    if (!this.isRendered()) {
      return [];
    }
    var answers = this.optInAnswers().concat(this.todOptOutAnswers());
    if (this.choice === "yes") {
      ["name", "relationship", "share"].forEach(function (key) { answers = answers.concat(this.nomineeAnswers(key)); }, this);
    }
    return answers;
  }

  // Enter in a nominee input saves that nominee rather than submitting the step.
  saveOnEnter(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      this.saveEntry();
    }
  }

  bindEvents() {
    var self = this;
    var $fields = $("#kycPartFields");
    $fields.on("change", "[name=kycNominationChoice]", function () { self.selectChoice(this.value); });
    $fields.on("click", "#kycNomineeSaveBtn", function () { self.saveEntry(); });
    $fields.on("click", "[data-remove-nominee]", function () { self.removeNominee($(this).data("remove-nominee")); });
    $fields.on("keydown", "#kycNomineeEditor input", function (event) { self.saveOnEnter(event); });
    document.getElementById("kycPartForm").addEventListener("submit", this.guardSubmit.bind(this), true);
  }
}

var KYC_AGREEMENT_STEP_LABEL = "Agreement and Declaration";

// One collapsible section per agreement checkbox (reference 4a/4b.png).
var KYC_AGREEMENT_SECTIONS = [
  { key: "declarations", title: "Declarations and Agreements", prefix: "I Agree" },
  { key: "fatca", title: "FATCA/CRS and W8-BEN", prefix: "I Agree and Sign" },
];

// Documents each agreement checkbox links to. Documents without a url
// show as plain text, and "Download All Documents" only appears once at
// least one url is filled in.
var KYC_AGREEMENT_DOCUMENTS = {
  declarations: [
    { title: "VTI IFSC Trade Handling Disclosure", url: null },
    { title: "VTI IFSC Global Market Investing Risk Disclosures", url: null },
    { title: "Crypto Asset Disclosures", url: null },
    { title: "NSEIX GA Complaint handling and Grievance redressal policy", url: null },
    { title: "AML KYC Policy", url: null },
  ],
  fatca: [
    { title: "FATCA CRS", url: null },
    { title: "W8 Ben", url: null },
    { title: "VTIIFSC Customer Account Agreement", url: null },
  ],
};

var KYC_ACCOUNT_AGREEMENT_URL =
  "https://drive.google.com/drive/folders/1w8OO5BkD2Eai1ZzCxr1ONlOnbZBA-oIa?usp=sharing";

var KYC_ACCOUNT_AGREEMENT_AFFIRMATION =
  "By signing this application, I affirm that I have read and accept the terms of the " +
  '<a href="' + KYC_ACCOUNT_AGREEMENT_URL + '" target="_blank" rel="noopener">VTI IFSC Customer ' +
  "Account Agreement</a> and will abide by such terms. I will receive and provide information related to my " +
  "Account through my Introducing Firm. I also represent and affirm that I will abide by the additional " +
  "policies, agreements, and terms of my Introducing Firm. Further, I represent and affirm that the " +
  "information I have provided in this application and in the future is accurate and up to date.";

// Vendor questions each agreement checkbox answers. Checked in order, so
// the more specific FATCA and affirmation patterns come first.
var KYC_AGREEMENT_QUESTION_PATTERNS = {
  fatca: /fatca|crs|w-?8/,
  affirmation: /customer-account-agreement|affirm|application\.sign/,
  declarations: /declaration|disclosure|agreement|consent|policy|terms/,
};

// The Agreement and Declaration step: an "I Agree" checkbox per section
// linking its documents, then "Download All Documents" and the account
// agreement affirmation. Ticking a checkbox answers its vendor questions.
class KycAgreementStep {
  constructor(sections, documents, patterns) {
    this.sections = sections;
    this.documents = documents;
    this.matcher = new KycQuestionMatcher(patterns);
    this.agreed = {};
  }

  claimVendorQuestions(questions) {
    return this.matcher.claim(questions);
  }

  afterRender() {}

  buildHtml(otherQuestionsHtml) {
    return this.sections.map(this.buildSectionHtml, this).join("") + otherQuestionsHtml + this.buildFooterHtml();
  }

  buildSectionHtml(section, index) {
    var bodyId = "kycSection_" + section.key;
    var isOpen = index === 0;
    var labelHtml = "<strong>" + section.prefix + "</strong> " + this.buildDocumentLinksHtml(section.key);
    return (
      '<div class="kyc-section">' +
        '<button type="button" class="kyc-section-toggle' + (isOpen ? "" : " collapsed") + '" ' +
          'data-bs-toggle="collapse" data-bs-target="#' + bodyId + '" aria-expanded="' + isOpen + '">' +
          "<span>" + section.title + '</span><i class="bi bi-dash-square"></i><i class="bi bi-plus-square"></i>' +
        "</button>" +
        '<div class="collapse' + (isOpen ? " show" : "") + '" id="' + bodyId + '">' +
          '<div class="kyc-section-body">' + this.buildCheckboxHtml(section.key, labelHtml, "kyc-agreement-box") + "</div>" +
        "</div>" +
      "</div>"
    );
  }

  buildCheckboxHtml(key, labelHtml, extraClass) {
    var checkboxId = "kycAgreement_" + key;
    var checkedAttr = this.agreed[key] ? "checked " : "";
    return (
      '<div class="form-check ' + extraClass + '">' +
        '<input class="form-check-input" type="checkbox" id="' + checkboxId + '" data-agreement="' + key + '" ' +
          checkedAttr + "required />" +
        '<label class="form-check-label" for="' + checkboxId + '">' + labelHtml + "</label>" +
      "</div>"
    );
  }

  buildDocumentLinksHtml(key) {
    return (this.documents[key] || []).map(function (doc) {
      if (!doc.url) {
        return "<span>" + doc.title + "</span>";
      }
      return '<a href="' + escapeHtmlAttr(doc.url) + '" target="_blank" rel="noopener">' + doc.title + "</a>";
    }).join(", ");
  }

  buildFooterHtml() {
    var downloadHtml = this.documentUrls().length
      ? '<button type="button" class="btn kyc-nominee-save w-100 mb-3" id="kycDownloadDocumentsBtn">Download All Documents</button>'
      : "";
    return (
      '<div class="mt-4">' +
        downloadHtml +
        this.buildCheckboxHtml("affirmation", KYC_ACCOUNT_AGREEMENT_AFFIRMATION, "kyc-agreement-affirmation") +
      "</div>"
    );
  }

  documentUrls() {
    return Object.keys(this.documents).reduce(function (urls, key) {
      return urls.concat(this.documents[key].filter(function (doc) { return doc.url; }).map(function (doc) { return doc.url; }));
    }.bind(this), []);
  }

  downloadAllDocuments() {
    this.documentUrls().forEach(function (url) { window.open(url, "_blank", "noopener"); });
  }

  isRendered() {
    return $("#kycPartFields [data-agreement]").length > 0;
  }

  // A yes/no or single-option question gets its agreeing option; a
  // free-form one gets "yes".
  agreedValue(question) {
    var options = question.options || [];
    var agreeing = options.filter(function (option) {
      return /^(yes|agree|accept|true)/i.test(option.system_identifier || "");
    })[0];
    var option = agreeing || (options.length === 1 ? options[0] : null);
    return option ? option.system_identifier : "yes";
  }

  buildAnswers() {
    if (!this.isRendered()) {
      return [];
    }
    return Object.keys(this.agreed)
      .filter(function (key) { return this.agreed[key]; }, this)
      .reduce(function (answers, key) {
        return answers.concat(this.matcher.all(key).map(function (question) {
          return { question_id: question.id, data: this.agreedValue(question) };
        }, this));
      }.bind(this), []);
  }

  bindEvents() {
    var self = this;
    var $fields = $("#kycPartFields");
    $fields.on("change", "[data-agreement]", function () { self.agreed[$(this).data("agreement")] = this.checked; });
    $fields.on("click", "#kycDownloadDocumentsBtn", function () { self.downloadAllDocuments(); });
  }
}

// Works out the answer for a field the form fills in without showing it.
class KycAutoAnswer {
  valueFor(question, field) {
    if (field.autoValue) {
      return field.autoValue;
    }
    if (question.type_id === QUESTION_TYPE_ID.COUNTRY) {
      return resolveCountryCode(matchPersonalDetailValue(question));
    }
    return matchPersonalDetailValue(question);
  }

  buildHiddenInputHtml(question, value) {
    return '<input type="hidden" data-question-id="' + question.id + '" value="' + escapeHtmlAttr(value) + '" />';
  }
}

class KycSectionedFormLayout {
  constructor(sections, fields, stepLabels) {
    this.sections = sections;
    this.fields = fields;
    this.stepLabels = stepLabels;
    this.signatureField = new KycSignatureField();
    this.autoAnswer = new KycAutoAnswer();
    this.nominationField = new KycNominationField(KYC_NOMINEE_QUESTION_PATTERNS);
    this.agreementStep = new KycAgreementStep(KYC_AGREEMENT_SECTIONS, KYC_AGREEMENT_DOCUMENTS, KYC_AGREEMENT_QUESTION_PATTERNS);
    this.stepWidgets = {};
    this.stepWidgets[KYC_NOMINATION_STEP_LABEL] = this.nominationField;
    this.stepWidgets[KYC_AGREEMENT_STEP_LABEL] = this.agreementStep;
  }

  stepWidgetList() {
    return Object.keys(this.stepWidgets).map(function (label) { return this.stepWidgets[label]; }, this);
  }

  currentStepWidget() {
    return this.stepWidgets[this.stepLabelFor(currentPartIndex)] || null;
  }

  // Answers from whichever step widget is on screen (the others add none).
  buildWidgetAnswers() {
    return this.stepWidgetList().reduce(function (answers, widget) { return answers.concat(widget.buildAnswers()); }, []);
  }

  // Converts the field list into the KYC_FIELD_ORDER shape kyc-form.js expects.
  buildFieldOrder() {
    return this.fields.map(function (field) {
      return {
        label: field.label,
        test: function (id) { return field.pattern.test(id) && !(field.exclude && field.exclude.test(id)); },
      };
    });
  }

  fieldFor(question) {
    return question._order === undefined ? null : this.fields[question._order];
  }

  // Section keys start with their part number ("1A", "2C"...); a part's
  // unmatched questions fall back to that part's last section.
  partNumberOf(questions) {
    var ordered = questions.filter(function (question) { return question._order !== undefined; })[0];
    return this.fieldFor(ordered).section.charAt(0);
  }

  sectionKeyFor(question, fallbackKey) {
    var field = this.fieldFor(question);
    return field ? field.section : fallbackKey;
  }

  groupQuestionsBySection(questions) {
    var partNumber = this.partNumberOf(questions);
    var partSections = this.sections.filter(function (section) { return section.key.charAt(0) === partNumber; });
    var fallbackKey = partSections[partSections.length - 1].key;
    var groups = {};
    this.sections.forEach(function (section) { groups[section.key] = []; });
    questions.forEach(function (question) {
      groups[this.sectionKeyFor(question, fallbackKey)].push(question);
    }, this);
    return groups;
  }

  buildFieldColumnHtml(question) {
    var field = this.fieldFor(question);
    var autoValue = field && (field.auto || field.autoValue) ? this.autoAnswer.valueFor(question, field) : null;
    if (autoValue) {
      return this.autoAnswer.buildHiddenInputHtml(question, autoValue);
    }
    var fieldHtml = field && field.signature ? this.signatureField.buildHtml(question) : buildQuestionFieldHtml(question, false);
    var columnClass = field && field.half ? "col-md-6" : "col-12";
    return '<div class="' + columnClass + '">' + fieldHtml + "</div>";
  }

  labelDependents(questions) {
    questions.forEach(function (question) {
      (question._dependents || []).forEach(function (dependent) {
        var entry = KYC_DEPENDENT_LABELS.filter(function (e) { return e.pattern.test(dependent.question.system_identifier || ""); })[0];
        dependent.question._label = dependent.question._label || (entry && entry.label);
        this.labelDependents([dependent.question]);
      }, this);
    }, this);
    return questions;
  }

  // Shows the conditional questions under any answer that was prefilled
  // (e.g. "U.S. citizen: No" reveals the tax treaty questions).
  revealPrefilledDependents() {
    $("#kycPartFields").find("[data-question-id]:checked, select[data-question-id]").each(function () {
      toggleDependentFields($(this));
    });
  }

  buildSectionHtml(section, questions, isOpen) {
    var bodyId = "kycSection_" + section.key;
    var fieldsHtml = questions.map(this.buildFieldColumnHtml, this).join("");
    return (
      '<div class="kyc-section">' +
        '<button type="button" class="kyc-section-toggle' + (isOpen ? "" : " collapsed") + '" ' +
          'data-bs-toggle="collapse" data-bs-target="#' + bodyId + '" aria-expanded="' + isOpen + '">' +
          "<span>" + section.title + '</span><i class="bi bi-dash-square"></i><i class="bi bi-plus-square"></i>' +
        "</button>" +
        '<div class="collapse' + (isOpen ? " show" : "") + '" id="' + bodyId + '">' +
          '<div class="row gx-3 kyc-section-body">' + fieldsHtml + "</div>" +
        "</div>" +
      "</div>"
    );
  }

  // Parts with no screenshot-ordered questions render as a plain field list.
  buildPartHtml(questions) {
    var isSectioned = questions.some(function (question) { return question._order !== undefined; });
    if (!isSectioned) {
      return '<div class="row">' + questions.map(this.buildFieldColumnHtml, this).join("") + "</div>";
    }
    var groups = this.groupQuestionsBySection(questions);
    var nonEmptySections = this.sections.filter(function (section) { return groups[section.key].length; });
    return nonEmptySections
      .map(function (section, index) { return this.buildSectionHtml(section, groups[section.key], index === 0); }, this)
      .join("");
  }

  stepLabelFor(index) {
    return this.stepLabels[index] || "Part " + (index + 1);
  }

  buildStepperHtml() {
    return kycParts
      .map(function (part, index) {
        var stateClass = index < currentPartIndex ? "is-done" : index === currentPartIndex ? "is-active" : "";
        return (
          '<div class="kyc-progress-step ' + stateClass + '">' +
            '<div class="kyc-progress-bar"></div>' +
            '<span class="d-none d-sm-block">' + this.stepLabelFor(index) + "</span>" +
          "</div>"
        );
      }, this)
      .join("");
  }

  renderStepper() {
    $("#kycStepper").html(this.buildStepperHtml());
  }

  // Nomination and agreement steps are built by their widget; the step's
  // other vendor questions (if any) render inside it as usual.
  buildCurrentPartHtml(part) {
    var widget = this.currentStepWidget();
    if (!widget) {
      return this.buildPartHtml(part.questions);
    }
    var otherQuestions = widget.claimVendorQuestions(part.questions);
    return widget.buildHtml(otherQuestions.length ? this.buildPartHtml(otherQuestions) : "");
  }

  renderCurrentPart() {
    var part = kycParts[currentPartIndex];
    var widget = this.currentStepWidget();
    $("#kycPartTitle").text(this.stepLabelFor(currentPartIndex));
    $("#kycPartFields").html(this.buildCurrentPartHtml(part));
    if (widget) {
      widget.afterRender();
    }
    this.revealPrefilledDependents();
    $("#kycPartBackBtn").toggleClass("d-none", currentPartIndex === 0);
    $("#kycPartNextBtn").text(currentPartIndex === kycParts.length - 1 ? "Submit" : "Next");
    this.renderStepper();
  }

  // Opens a collapsed section when one of its fields fails validation, so
  // the browser can focus the field and show its validation message.
  revealInvalidField(event) {
    var $collapse = $(event.target).closest(".collapse");
    if (!$collapse.length || $collapse.hasClass("show")) {
      return;
    }
    $collapse.addClass("show");
    $collapse.prev(".kyc-section-toggle").removeClass("collapsed").attr("aria-expanded", "true");
  }

  bindInvalidFieldReveal() {
    var formEl = document.getElementById("kycPartForm");
    formEl.addEventListener("invalid", this.revealInvalidField.bind(this), true);
  }

  bindEvents() {
    this.bindInvalidFieldReveal();
    this.signatureField.bindEvents();
    this.stepWidgetList().forEach(function (widget) { widget.bindEvents(); });
  }
}

var kycSectionedFormLayout = new KycSectionedFormLayout(KYC_FORM_SECTIONS, KYC_SECTIONED_FIELDS, KYC_STEP_LABELS);

// Overrides the kyc-form.js globals; they are only called at runtime, after this file loads.
KYC_FIELD_ORDER = kycSectionedFormLayout.buildFieldOrder();
window.renderKycStepper = function () { kycSectionedFormLayout.renderStepper(); };
window.renderCurrentKycPart = function () { kycSectionedFormLayout.renderCurrentPart(); };
var baseVisibleQuestionsForPage = visibleQuestionsForPage;
window.visibleQuestionsForPage = function (page) {
  return kycSectionedFormLayout.labelDependents(baseVisibleQuestionsForPage(page));
};
var baseCollectCurrentPartAnswers = collectCurrentPartAnswers;
window.collectCurrentPartAnswers = function () {
  return baseCollectCurrentPartAnswers().concat(kycSectionedFormLayout.buildWidgetAnswers());
};

$(function () {
  kycSectionedFormLayout.bindEvents();
});
