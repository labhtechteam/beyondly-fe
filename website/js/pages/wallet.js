// Balance fields from ViewTrade's /api/user/balance, best match first.
var BUYING_POWER_FIELDS = ["availableCash"];
var WITHDRAWABLE_FIELDS = ["cashOnAccount"];
var SETTLED_STATUSES = ["SUCCESS", "COMPLETED", "APPROVED", "SETTLED", "ACTIVE"];
var FAILED_STATUSES = ["REJECTED", "FAILED", "CANCELED", "CANCELLED", "RETURNED"];
var CURRENCY_SYMBOLS = { USD: "$", INR: "₹" };
var BANK_LOGO_COLORS = ["#7a3fd1", "#c2410c", "#1d6fb8", "#2f8f6b", "#b83280", "#0e7490"];
var HIDE_BALANCES_STORAGE_KEY = "beyondly_hide_balances";
var WALLET_SECTIONS = ["deposit", "withdraw", "history", "banks"];
// ViewTrade rejects smaller deposits; keep in sync with MINIMUM_DEPOSIT_AMOUNT in wallet/views.py.
var MINIMUM_DEPOSIT_AMOUNT = 1700;
var HISTORY_DEFAULT_MONTHS = 3;
// Glomo's Unified SDK; a test_ public key switches it to mock mode on the same host.
var GLOMO_SDK_URL = "https://unified-sdk.glomopay.com/index.js";


// Formatting helpers shared by every wallet section.
class WalletFormat {
  static escape(text) {
    return $("<div>").text(text == null ? "" : String(text)).html();
  }

  static money(amount, currency) {
    var number = Number(amount);
    if (amount === null || amount === undefined || !isFinite(number)) {
      return "—";
    }
    var symbol = CURRENCY_SYMBOLS[currency] || (currency ? currency + " " : "$");
    return symbol + number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Broker dates look like "08/18/2026 17:13:08 IST", which Date() can't parse.
  static parseDate(rawDate) {
    var brokerDate = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(rawDate || "");
    if (brokerDate) {
      return new Date(Number(brokerDate[3]), Number(brokerDate[1]) - 1, Number(brokerDate[2]));
    }
    var parsed = new Date(rawDate);
    return isNaN(parsed) ? null : parsed;
  }

  static inputDate(date) {
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return date.getFullYear() + "-" + month + "-" + day;
  }

  // Collapses the broker's many states into pending / completed / rejected.
  static statusGroup(status) {
    var normalized = String(status || "").toUpperCase();
    if (SETTLED_STATUSES.indexOf(normalized) >= 0) {
      return "completed";
    }
    return FAILED_STATUSES.indexOf(normalized) >= 0 ? "rejected" : "pending";
  }

  static statusPillHtml(status) {
    var pillClasses = { completed: "pill-approved", rejected: "pill-sell", pending: "pill-pending" };
    var label = String(status || "pending").toLowerCase();
    var pillClass = pillClasses[WalletFormat.statusGroup(status)];
    return "<span class='pill " + pillClass + "'>" + WalletFormat.escape(label) + "</span>";
  }
}


// Finds a figure in the broker's balance payload, whatever its nesting.
class BalanceReader {
  static find(payload, fieldNames, depth) {
    depth = depth || 0;
    if (!payload || typeof payload !== "object" || depth > 3) {
      return null;
    }
    var directValue = BalanceReader.directValue(payload, fieldNames);
    if (directValue !== null) {
      return directValue;
    }
    var nestedValues = Object.values(payload).map(function (value) {
      return BalanceReader.find(value, fieldNames, depth + 1);
    });
    return nestedValues.find(function (value) { return value !== null; }) ?? null;
  }

  // Field names are matched ignoring case; ViewTrade's casing isn't consistent.
  static directValue(payload, fieldNames) {
    var wantedNames = fieldNames.map(function (name) { return name.toLowerCase(); });
    var fieldName = Object.keys(payload).find(function (key) {
      var value = payload[key];
      return wantedNames.indexOf(key.toLowerCase()) >= 0 && value !== null && value !== "" && isFinite(Number(value));
    });
    return fieldName ? Number(payload[fieldName]) : null;
  }
}


// Buying power and withdrawable cash, with an eye toggle that masks both.
class BalanceStrip {
  constructor() {
    this.buyingPower = null;
    this.withdrawable = null;
    this.isHidden = BalanceStrip.readHiddenPreference();
  }

  static readHiddenPreference() {
    try {
      return localStorage.getItem(HIDE_BALANCES_STORAGE_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  bind() {
    var strip = this;
    $("#balanceVisibilityToggle").on("click", function () { strip.toggleHidden(); });
    $('[data-bs-toggle="tooltip"]').each(function () { new bootstrap.Tooltip(this); });
  }

  load() {
    var strip = this;
    return callBeyondlyApi("GET", "/wallet/balance/")
      .done(function (response) {
        strip.buyingPower = BalanceReader.find(response.balance, BUYING_POWER_FIELDS);
        strip.withdrawable = BalanceReader.find(response.balance, WITHDRAWABLE_FIELDS);
        $("#balanceErrorNote").addClass("d-none");
        strip.render();
      })
      .fail(function (jqXHR) {
        $("#balanceErrorNote").text(extractApiErrorMessage(jqXHR)).removeClass("d-none");
      });
  }

  toggleHidden() {
    this.isHidden = !this.isHidden;
    try {
      localStorage.setItem(HIDE_BALANCES_STORAGE_KEY, this.isHidden ? "1" : "0");
    } catch (error) {
      // The preference simply won't survive a reload.
    }
    this.render();
  }

  render() {
    var mask = this.isHidden ? function () { return "$•••••"; } : WalletFormat.money;
    $("#buyingPowerValue").text(mask(this.buyingPower, "USD"));
    $("#withdrawableValue").text(mask(this.withdrawable, "USD"));
    $("#withdrawAvailableValue").text(WalletFormat.money(this.withdrawable, "USD"));
    $("#balanceVisibilityToggle i").attr("class", this.isHidden ? "bi bi-eye-slash" : "bi bi-eye");
  }
}


// Turns a broker bank link ("Kotak Mahindra Bank x4277") into card display data.
class BankCard {
  static fromBroker(bank) {
    var nickname = String(bank.nickname || bank.externalId || "Bank account");
    var lastDigits = /x(\d{3,4})\s*$/i.exec(nickname);
    var status = String(bank.status || "").toUpperCase();
    return {
      entryId: String(bank.entryId),
      name: nickname.replace(/\s*x\d{3,4}\s*$/i, "") || "Bank account",
      lastDigits: lastDigits ? lastDigits[1] : "••••",
      status: status,
      isActive: WalletFormat.statusGroup(status) !== "rejected",
    };
  }

  static logoHtml(name) {
    var hash = 0;
    for (var i = 0; i < name.length; i++) {
      hash = (hash + name.charCodeAt(i)) % BANK_LOGO_COLORS.length;
    }
    var initials = name.split(/\s+/).slice(0, 2).map(function (word) { return word[0]; }).join("");
    return "<span class='wlt-bank-logo' style='background:" + BANK_LOGO_COLORS[hash] + "'>" + WalletFormat.escape(initials.toUpperCase()) + "</span>";
  }

  static html(card, isSelectable, isSelected) {
    var tag = isSelectable ? "button type='button'" : "div";
    var stateClass = (isSelected ? " is-selected" : "") + (card.isActive ? "" : " is-inactive");
    return (
      "<" + tag + " class='wlt-bank-card" + stateClass + "' data-bank-entry='" + WalletFormat.escape(card.entryId) + "'>" +
        "<div class='wlt-bank-card-body'>" +
          "<div class='wlt-bank-card-head'>" + BankCard.logoHtml(card.name) +
            "<span class='wlt-bank-name'>" + WalletFormat.escape(card.name) + "</span>" +
            BankCard.cornerHtml(card, isSelectable) + "</div>" +
          "<div class='wlt-bank-label'>Account ending in</div>" +
          "<div class='wlt-bank-number'>**** **** **** <strong>" + WalletFormat.escape(card.lastDigits) + "</strong></div>" +
        "</div>" +
        (isSelected ? "<div class='wlt-bank-selected'><i class='bi bi-check-circle-fill'></i> Selected</div>" : "") +
      "</" + tag.split(" ")[0] + ">"
    );
  }

  static cornerHtml(card, isSelectable) {
    if (!isSelectable && WalletFormat.statusGroup(card.status) !== "completed") {
      return WalletFormat.statusPillHtml(card.status);
    }
    return "<i class='bi bi-wifi wlt-contactless'></i>";
  }

  static addTileHtml() {
    return (
      "<button type='button' class='wlt-bank-add' data-bs-toggle='modal' data-bs-target='#addBankModal'>" +
        "<span><i class='bi bi-plus-lg'></i></span>Add another bank for a seamless journey" +
      "</button>"
    );
  }
}


// Linked banks: one shared selection drives both the deposit and withdraw cards.
class BankAccountsPanel {
  constructor(onSelectionChange) {
    this.cards = [];
    this.selectedEntryId = null;
    this.onSelectionChange = onSelectionChange;
  }

  bind() {
    var panel = this;
    $(document).on("click", "[data-bank-grid='selectable'] .wlt-bank-card", function () {
      panel.select($(this).data("bank-entry"));
    });
  }

  load() {
    var panel = this;
    return callBeyondlyApi("GET", "/wallet/banks/")
      .done(function (response) { panel.setCards((response.results || []).map(BankCard.fromBroker)); })
      .fail(function () { panel.setCards([]); });
  }

  setCards(cards) {
    this.cards = cards;
    var activeCards = this.activeCards();
    var stillActive = activeCards.some(function (card) { return card.entryId === this.selectedEntryId; }, this);
    this.select(stillActive ? this.selectedEntryId : (activeCards[0] || {}).entryId || null);
  }

  activeCards() {
    return this.cards.filter(function (card) { return card.isActive; });
  }

  selectedCard() {
    var selectedEntryId = this.selectedEntryId;
    return this.cards.find(function (card) { return card.entryId === selectedEntryId; }) || null;
  }

  select(entryId) {
    this.selectedEntryId = entryId === null || entryId === undefined ? null : String(entryId);
    this.render();
    this.onSelectionChange();
  }

  render() {
    var selectedEntryId = this.selectedEntryId;
    var selectableHtml = this.activeCards().map(function (card) {
      return BankCard.html(card, true, card.entryId === selectedEntryId);
    });
    var allHtml = this.cards.map(function (card) { return BankCard.html(card, false, false); });
    $("[data-bank-grid='selectable']").html(selectableHtml.join("") + BankCard.addTileHtml());
    $("[data-bank-grid='all']").html(allHtml.join("") + BankCard.addTileHtml());
    $("[data-selected-bank-name]").text(this.selectedCard() ? this.selectedCard().name : "No bank selected");
  }
}


// The "Link a bank account" modal.
class AddBankDialog {
  constructor(onLinked) {
    this.onLinked = onLinked;
    this.$form = $("#addBankForm");
  }

  bind() {
    var dialog = this;
    this.$form.on("submit", function (event) {
      event.preventDefault();
      dialog.submit();
    });
  }

  formBody() {
    return {
      beneficiary_name: $("#bankBeneficiaryName").val().trim(),
      bank_account: $("#bankAccountNumber").val().replace(/\s+/g, ""),
      ifsc_code: $("#bankIfscCode").val().trim().toUpperCase(),
    };
  }

  submit() {
    var dialog = this;
    var $submitButton = $("#addBankSubmit").prop("disabled", true);
    $("#addBankError").addClass("d-none");
    callBeyondlyApi("POST", "/wallet/banks/", { body: this.formBody() })
      .done(function () { dialog.close(); })
      .fail(function (jqXHR) {
        $("#addBankError").text(extractApiErrorMessage(jqXHR)).removeClass("d-none");
      })
      .always(function () { $submitButton.prop("disabled", false); });
  }

  close() {
    this.$form[0].reset();
    bootstrap.Modal.getOrCreateInstance(document.getElementById("addBankModal")).hide();
    this.onLinked();
  }
}


// Shared behaviour of the deposit and withdraw forms: amount, quick chips, submit.
class FundsTransferForm {
  constructor(formSelector, endpoint, banks, onSubmitted) {
    this.$form = $(formSelector);
    this.endpoint = endpoint;
    this.banks = banks;
    this.onSubmitted = onSubmitted;
  }

  bind() {
    var form = this;
    this.$form.find("[data-amount-input]").on("input", function () { form.refreshState(); });
    this.$form.find("[data-quick-amount]").on("click", function () { form.applyQuickAmount($(this).data("quick-amount")); });
    this.$form.on("submit", function (event) {
      event.preventDefault();
      form.submit();
    });
  }

  amount() {
    return parseFloat(this.$form.find("[data-amount-input]").val());
  }

  applyQuickAmount(quickAmount) {
    this.$form.find("[data-amount-input]").val(quickAmount);
    this.refreshState();
  }

  isReady() {
    return this.amount() > 0 && !!this.banks.selectedCard();
  }

  refreshState() {
    this.$form.find(".wlt-submit").prop("disabled", !this.isReady());
  }

  submit() {
    if (!this.isReady()) {
      return;
    }
    var form = this;
    var body = { amount: this.amount(), bank_entry_id: this.banks.selectedEntryId };
    var $submitButton = this.$form.find(".wlt-submit").prop("disabled", true);
    WalletPage.hideError();
    this.$form.find("[data-success-alert]").addClass("d-none");
    callBeyondlyApi("POST", this.endpoint, { body: body })
      .done(function (response) { form.onSuccess(response.broker_response || {}); })
      .fail(function (jqXHR) { WalletPage.showError(extractApiErrorMessage(jqXHR)); })
      .always(function () { form.refreshState(); });
  }

  showSuccess(message, brokerResponse) {
    var reference = brokerResponse.transactionId || brokerResponse.order_id;
    this.$form.find("[data-success-alert]").text(message + (reference ? " Reference: " + reference : "")).removeClass("d-none");
    this.$form.find("[data-amount-input]").val("");
    this.refreshState();
    this.onSubmitted();
  }
}


// Opens Glomo's checkout for a ViewTrade deposit order. ViewTrade creates the order
// against an LRS quote, so the Unified SDK runs the LRS journey on its own.
class GlomoLrsCheckout {
  constructor(brokerResponse, callbacks) {
    this.publicKey = brokerResponse.public_key;
    this.orderId = brokerResponse.order_id;
    this.callbacks = callbacks;
  }

  canOpen() {
    return !!(this.publicKey && this.orderId);
  }

  open() {
    var checkout = this;
    return import(GLOMO_SDK_URL).then(function (sdk) {
      var glomo = new sdk.GlomoCheckoutApi({ publicKey: checkout.publicKey, orderId: checkout.orderId });
      checkout.listen(glomo);
      return glomo.open();
    });
  }

  listen(glomo) {
    var callbacks = this.callbacks;
    glomo.on("payment.success", function (payload) { callbacks.onSuccess(payload || {}); });
    glomo.on("payment.failure", function (payload) { callbacks.onFailure(GlomoLrsCheckout.failureMessage(payload)); });
    glomo.on("checkout.closed", function () { callbacks.onClosed(); });
  }

  // LRS failures carry flat errorCode/errorMessage; standard ones nest them under error.
  static failureMessage(payload) {
    var failure = payload || {};
    var message = failure.errorMessage || (failure.error && failure.error.message);
    return message || "Your deposit could not be completed. Please try again.";
  }
}


class DepositForm extends FundsTransferForm {
  constructor(banks, onSubmitted) {
    super("#depositForm", "/wallet/deposit/", banks, onSubmitted);
    this.hasPan = false;
  }

  loadPan() {
    var form = this;
    callBeyondlyApi("GET", "/user/profile/").done(function (profile) {
      form.hasPan = !!profile.pan_number;
      $("#depositPan").val(profile.pan_number || "Not on file. Complete KYC to deposit.");
      form.refreshState();
    });
  }

  isBelowMinimum() {
    return this.amount() > 0 && this.amount() < MINIMUM_DEPOSIT_AMOUNT;
  }

  isReady() {
    return this.hasPan && super.isReady() && !this.isBelowMinimum();
  }

  refreshState() {
    super.refreshState();
    this.$form.find("[data-amount-error]").toggle(this.isBelowMinimum());
  }

  // A deposit hands back either Glomo's SDK order or a payment page to send the user to.
  onSuccess(brokerResponse) {
    if (brokerResponse.redirectType === "sdk") {
      this.openGlomoCheckout(brokerResponse);
      return;
    }
    if (/^https:\/\//.test(brokerResponse.redirectTo || "")) {
      window.location.href = brokerResponse.redirectTo;
      return;
    }
    this.showSuccess("Deposit initiated.", brokerResponse);
  }

  openGlomoCheckout(brokerResponse) {
    var form = this;
    var checkout = new GlomoLrsCheckout(brokerResponse, {
      onSuccess: function () { form.showSuccess("Deposit submitted. Funds reach your account once your bank completes the LRS remittance.", brokerResponse); },
      onFailure: function (message) { WalletPage.showError(message); form.onSubmitted(); },
      onClosed: function () { form.onSubmitted(); },
    });
    if (!checkout.canOpen()) {
      WalletPage.showError("Payment could not be started. Please try again.");
      return;
    }
    checkout.open().catch(function () { WalletPage.showError("Could not load the payment window. Please try again."); });
  }
}


class WithdrawForm extends FundsTransferForm {
  constructor(banks, balances, onSubmitted) {
    super("#withdrawForm", "/wallet/withdraw/", banks, onSubmitted);
    this.balances = balances;
  }

  applyQuickAmount(quickAmount) {
    var available = this.balances.withdrawable;
    super.applyQuickAmount(quickAmount === "all" ? (available > 0 ? available.toFixed(2) : "") : quickAmount);
  }

  exceedsAvailable() {
    var available = this.balances.withdrawable;
    return available !== null && this.amount() > available;
  }

  isReady() {
    return super.isReady() && !this.exceedsAvailable();
  }

  refreshState() {
    super.refreshState();
    this.$form.find("[data-amount-error]").toggle(this.exceedsAvailable());
  }

  onSuccess(brokerResponse) {
    this.showSuccess("Withdrawal requested.", brokerResponse);
  }
}


// Turns broker transfers and local ledger entries into the same row shape.
class TransferRow {
  static fromBroker(transfer) {
    return {
      date: WalletFormat.parseDate(transfer.createdOn),
      direction: String(transfer.direction).toUpperCase() === "OUTGOING" ? "WITHDRAW" : "DEPOSIT",
      reference: transfer.transferId,
      method: transfer.mechanism,
      amount: transfer.amount,
      currency: transfer.currency,
      status: transfer.state,
    };
  }

  static fromLedger(entry) {
    return {
      date: WalletFormat.parseDate(entry.created_at),
      direction: entry.txn_type === "debit" ? "WITHDRAW" : "DEPOSIT",
      reference: entry.transaction_id,
      method: entry.bank_name,
      amount: entry.amount,
      currency: entry.currency,
      status: entry.status,
    };
  }

  static html(row) {
    var sign = row.direction === "DEPOSIT" ? "+" : "-";
    return (
      "<tr>" +
        "<td>" + (row.date ? row.date.toLocaleDateString() : "—") + "</td>" +
        "<td>" + WalletFormat.escape(row.reference || "—") + "</td>" +
        "<td>" + WalletFormat.escape(row.method || "—") + "</td>" +
        "<td>" + sign + WalletFormat.money(row.amount, row.currency) + "</td>" +
        "<td>" + WalletFormat.statusPillHtml(row.status) + "</td>" +
      "</tr>"
    );
  }
}


// Deposit / withdrawal history with status and date filters.
class TransactionHistoryPanel {
  constructor() {
    this.rows = [];
    this.direction = "DEPOSIT";
  }

  bind() {
    var panel = this;
    $("#historyDirectionTabs button").on("click", function () { panel.setDirection($(this).data("direction")); });
    $("#historyStatusFilter, #historyFromDate, #historyToDate").on("change", function () { panel.render(); });
    this.setDefaultDates();
  }

  setDefaultDates() {
    var today = new Date();
    var fromDate = new Date(today.getFullYear(), today.getMonth() - HISTORY_DEFAULT_MONTHS, today.getDate());
    $("#historyFromDate").val(WalletFormat.inputDate(fromDate));
    $("#historyToDate").val(WalletFormat.inputDate(today));
  }

  // Broker transfer status first; Beyondly's own ledger when the broker is unreachable.
  load() {
    var panel = this;
    callBeyondlyApi("GET", "/wallet/transfers/")
      .done(function (response) { panel.show((response.results || []).map(TransferRow.fromBroker), false); })
      .fail(function () { panel.loadLedger(); });
  }

  loadLedger() {
    var panel = this;
    $.when(callBeyondlyApi("GET", "/wallet/deposit/history/"), callBeyondlyApi("GET", "/wallet/withdraw/history/"))
      .done(function (deposits, withdrawals) {
        var entries = (deposits[0].results || []).concat(withdrawals[0].results || []);
        panel.show(entries.map(TransferRow.fromLedger), true);
      })
      .fail(function () { panel.show([], true); });
  }

  show(rows, isLedgerFallback) {
    this.rows = rows.sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
    $("#historySourceNote").toggleClass("d-none", !isLedgerFallback);
    this.render();
  }

  setDirection(direction) {
    this.direction = direction;
    $("#historyDirectionTabs button").removeClass("active");
    $('#historyDirectionTabs button[data-direction="' + direction + '"]').addClass("active");
    this.render();
  }

  matchesFilters(row) {
    var status = $("#historyStatusFilter").val();
    var fromDate = $("#historyFromDate").val() ? new Date($("#historyFromDate").val() + "T00:00:00") : null;
    var toDate = $("#historyToDate").val() ? new Date($("#historyToDate").val() + "T23:59:59") : null;
    var inRange = !row.date || ((!fromDate || row.date >= fromDate) && (!toDate || row.date <= toDate));
    var statusMatches = status === "all" || WalletFormat.statusGroup(row.status) === status;
    return row.direction === this.direction && inRange && statusMatches;
  }

  render() {
    var visibleRows = this.rows.filter(this.matchesFilters, this);
    $("#historyTableBody").html(visibleRows.map(TransferRow.html).join(""));
    $("#historyTableWrap").toggleClass("d-none", visibleRows.length === 0);
    $("#historyEmptyState").toggleClass("d-none", visibleRows.length > 0);
  }
}


// Left-hand section switcher, kept in sync with the URL hash.
class WalletSectionNav {
  bind() {
    var nav = this;
    $("#walletNav button").on("click", function () { nav.show($(this).data("section"), true); });
    $(window).on("hashchange", function () { nav.showFromHash(); });
    this.showFromHash();
  }

  showFromHash() {
    var section = window.location.hash.replace("#", "");
    this.show(WALLET_SECTIONS.indexOf(section) >= 0 ? section : "deposit", false);
  }

  show(section, updateHash) {
    WALLET_SECTIONS.forEach(function (name) {
      $("#section-" + name).toggleClass("d-none", name !== section);
    });
    $("#walletNav button").removeClass("active");
    $('#walletNav button[data-section="' + section + '"]').addClass("active");
    if (updateHash && window.location.hash !== "#" + section) {
      window.location.hash = section;
    }
  }
}


class WalletPage {
  constructor() {
    this.balances = new BalanceStrip();
    this.banks = new BankAccountsPanel(this.refreshForms.bind(this));
    this.history = new TransactionHistoryPanel();
    this.depositForm = new DepositForm(this.banks, this.refreshAccount.bind(this));
    this.withdrawForm = new WithdrawForm(this.banks, this.balances, this.refreshAccount.bind(this));
    this.addBankDialog = new AddBankDialog(this.banks.load.bind(this.banks));
  }

  static showError(message) {
    $("#walletErrorAlert").text(message).removeClass("d-none");
  }

  static hideError() {
    $("#walletErrorAlert").addClass("d-none");
  }

  start() {
    [new WalletSectionNav(), this.balances, this.banks, this.history, this.depositForm, this.withdrawForm, this.addBankDialog]
      .forEach(function (component) { component.bind(); });
    this.banks.load();
    this.depositForm.loadPan();
    this.refreshAccount();
  }

  refreshAccount() {
    this.balances.load().always(this.refreshForms.bind(this));
    this.history.load();
  }

  refreshForms() {
    this.depositForm.refreshState();
    this.withdrawForm.refreshState();
  }
}


$(function () {
  if (!requireSignedInUser()) {
    return;
  }
  new WalletPage().start();
});
