var BASKET_MAX_ORDERS = 20;
var BASKET_DRAFT_STORAGE_KEY = "beyondly_basket_draft";
var LIMIT_PRICE_CATEGORIES = ["limit", "stop_limit"];
var STOP_PRICE_CATEGORIES = ["stop", "stop_limit"];
var CATEGORY_LABELS = {
  market_price: "Market", limit: "Limit", stop: "Stop",
  stop_limit: "Stop Limit", fractional: "Fractional",
};

// Escapes text before it is placed inside HTML markup.
function escapeHtml(text) {
  return $("<div>").text(text === null || text === undefined ? "" : String(text)).html();
}

// One editable order row in the basket.
class BasketLegRow {
  constructor(values) {
    var template = document.getElementById("basketLegTemplate");
    this.$element = $(template.content.firstElementChild.cloneNode(true));
    this.fillValues(values || {});
    this.$element.find('[data-field="order_category"]').on("change", () => this.toggleCategoryFields());
    this.toggleCategoryFields();
  }

  field(name) {
    return this.$element.find('[data-field="' + name + '"]');
  }

  fillValues(values) {
    Object.keys(values).forEach((name) => {
      if (values[name] !== null && values[name] !== undefined) {
        this.field(name).val(values[name]);
      }
    });
  }

  category() {
    return this.field("order_category").val();
  }

  // Enables only the price inputs the chosen order type needs.
  toggleCategoryFields() {
    var category = this.category();
    this.field("limit_price").prop("disabled", LIMIT_PRICE_CATEGORIES.indexOf(category) === -1);
    this.field("stop_price").prop("disabled", STOP_PRICE_CATEGORIES.indexOf(category) === -1);
    this.field("quantity").attr("placeholder", category === "fractional" ? "Amount ($)" : "Qty");
    this.$element.find(".field-error").hide();
  }

  readValues() {
    return {
      order_type: this.field("order_type").val(),
      symbol: this.field("symbol").val().trim().toUpperCase(),
      exchange_name: this.field("exchange_name").val(),
      order_category: this.category(),
      quantity: this.field("quantity").val(),
      limit_price: this.field("limit_price").val(),
      stop_price: this.field("stop_price").val(),
    };
  }

  showError(name) {
    this.$element.find('[data-error="' + name + '"]').show();
  }

  // Marks invalid fields and returns true only if this row can be submitted.
  validate() {
    var values = this.readValues();
    var problems = [];
    this.$element.find(".field-error").hide();
    if (!values.symbol) problems.push("symbol");
    if (!(parseFloat(values.quantity) > 0)) problems.push("quantity");
    if (this.needsPrice("limit_price") && !(parseFloat(values.limit_price) > 0)) problems.push("limit_price");
    if (this.needsPrice("stop_price") && !(parseFloat(values.stop_price) > 0)) problems.push("stop_price");
    problems.forEach((name) => this.showError(name));
    return problems.length === 0;
  }

  needsPrice(name) {
    var categories = name === "limit_price" ? LIMIT_PRICE_CATEGORIES : STOP_PRICE_CATEGORIES;
    return categories.indexOf(this.category()) !== -1;
  }

  // Builds the JSON body for this leg of POST /trading/orders/basket/.
  toRequestBody(countryId) {
    var values = this.readValues();
    var body = {
      symbol: values.symbol, order_type: values.order_type,
      order_category: values.order_category, exchange_name: values.exchange_name,
      country_id: countryId, quantity: parseFloat(values.quantity),
    };
    if (this.needsPrice("limit_price")) body.limit_price = parseFloat(values.limit_price);
    if (this.needsPrice("stop_price")) body.stop_price = parseFloat(values.stop_price);
    return body;
  }
}

// Saves and restores the in-progress basket so a reload does not lose it.
class BasketDraftStore {
  save(rowValues) {
    try {
      localStorage.setItem(BASKET_DRAFT_STORAGE_KEY, JSON.stringify(rowValues));
    } catch (error) {
      // Storage can be unavailable (private mode); the draft is a convenience only.
    }
  }

  load() {
    try {
      var saved = JSON.parse(localStorage.getItem(BASKET_DRAFT_STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch (error) {
      return [];
    }
  }
}

// Holds the list of rows and keeps the summary and draft in sync.
class BasketBuilder {
  constructor(draftStore) {
    this.rows = [];
    this.draftStore = draftStore;
    this.$list = $("#basketLegList");
    this.$list.on("input change", () => this.onBasketChanged());
  }

  addRow(values) {
    if (this.rows.length >= BASKET_MAX_ORDERS) return;
    var row = new BasketLegRow(values);
    row.$element.find('[data-action="remove"]').on("click", () => this.removeRow(row));
    this.rows.push(row);
    this.$list.append(row.$element);
    this.onBasketChanged();
  }

  removeRow(row) {
    this.rows = this.rows.filter((candidate) => candidate !== row);
    row.$element.remove();
    if (this.rows.length === 0) this.addRow();
    this.onBasketChanged();
  }

  replaceRows(rowValuesList) {
    this.rows.forEach((row) => row.$element.remove());
    this.rows = [];
    rowValuesList.forEach((values) => this.addRow(values));
    if (this.rows.length === 0) this.addRow();
  }

  validateAll() {
    return this.rows.map((row) => row.validate()).every(Boolean);
  }

  onBasketChanged() {
    this.draftStore.save(this.rows.map((row) => row.readValues()));
    this.updateSummary();
  }

  updateSummary() {
    var sides = this.rows.map((row) => row.readValues().order_type);
    var buyCount = sides.filter((side) => side === "buy").length;
    var orderWord = this.rows.length === 1 ? "order" : "orders";
    $("#basketSummary").text(this.rows.length + " " + orderWord + " · " + buyCount + " buy · " +
      (sides.length - buyCount) + " sell · max " + BASKET_MAX_ORDERS);
    $("#addLegBtn").prop("disabled", this.rows.length >= BASKET_MAX_ORDERS);
    $("#reviewBasketBtn").text("Review Basket (" + this.rows.length + ")");
  }
}

// Renders the confirmation table shown before the basket is sent.
class BasketConfirmView {
  constructor() {
    this.modal = new bootstrap.Modal(document.getElementById("basketConfirmModal"));
  }

  show(rows) {
    $("#basketConfirmBody").html(rows.map((row) => this.rowHtml(row.readValues())).join(""));
    $("#basketConfirmSummary").text("You are about to place " + rows.length +
      " order(s). Each is sent to the broker separately, so some may fill while others are rejected.");
    this.modal.show();
  }

  hide() {
    this.modal.hide();
  }

  rowHtml(values) {
    var sideClass = values.order_type === "buy" ? "pill-buy" : "pill-sell";
    var quantity = values.order_category === "fractional" ? "$" + values.quantity : values.quantity;
    return "<tr><td><span class=\"pill " + sideClass + "\">" + escapeHtml(values.order_type.toUpperCase()) +
      "</span></td><td>" + escapeHtml(values.symbol) + "</td><td>" + escapeHtml(values.exchange_name.toUpperCase()) +
      "</td><td>" + escapeHtml(CATEGORY_LABELS[values.order_category]) + "</td><td>" + escapeHtml(quantity) +
      "</td><td>" + escapeHtml(values.limit_price || "—") + "</td><td>" + escapeHtml(values.stop_price || "—") + "</td></tr>";
  }
}

// Renders the per-order outcome returned by the basket endpoint.
class BasketResultsView {
  render(response) {
    $("#basketResultsBody").html(response.orders.map((order) => this.rowHtml(order)).join(""));
    $("#basketResultsSummary").text(response.placed_count + " placed · " + response.failed_count + " failed");
    $("#basketResultsCard").removeClass("d-none");
    document.getElementById("basketResultsCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  rowHtml(order) {
    var placed = order.status === "success";
    var statusPill = placed ? "<span class=\"pill pill-approved\">Placed</span>" : "<span class=\"pill pill-sell\">Failed</span>";
    var sideClass = order.order_type === "buy" ? "pill-buy" : "pill-sell";
    var detail = placed ? order.broker_order_id : order.reason;
    return "<tr><td>" + escapeHtml(order.symbol) + "</td><td><span class=\"pill " + sideClass + "\">" +
      escapeHtml(order.order_type.toUpperCase()) + "</span></td><td>" + escapeHtml(CATEGORY_LABELS[order.order_category]) +
      "</td><td>" + escapeHtml(parseFloat(order.quantity)) + "</td><td>" + statusPill + "</td><td class=\"small text-muted-custom\">" +
      escapeHtml(detail || "—") + "</td></tr>";
  }
}

// Wires the builder, confirmation, submission and results together.
class BasketOrderPage {
  constructor() {
    this.builder = new BasketBuilder(new BasketDraftStore());
    this.confirmView = new BasketConfirmView();
    this.resultsView = new BasketResultsView();
  }

  start() {
    this.builder.replaceRows(this.builder.draftStore.load());
    new SymbolAutocomplete('[data-field="symbol"]', (input, suggestion) => this.applySuggestion(input, suggestion))
      .bind($("#basketLegList"));
    $("#addLegBtn").on("click", () => this.builder.addRow());
    $("#clearBasketBtn").on("click", () => this.builder.replaceRows([]));
    $("#reviewBasketBtn").on("click", () => this.review());
    $("#placeBasketBtn").on("click", () => this.submit());
  }

  // Also selects the leg's exchange when the suggestion names one we support.
  applySuggestion(input, suggestion) {
    var exchangeName = suggestion.exchangeName();
    var $exchange = $(input).closest(".basket-leg").find('[data-field="exchange_name"]');
    if (exchangeName) $exchange.val(exchangeName).trigger("change");
    $(input).closest(".basket-leg").find('[data-error="symbol"]').hide();
  }

  showError(message) {
    $("#basketErrorAlert").text(message).toggleClass("d-none", !message);
  }

  review() {
    this.showError("");
    if (!this.builder.validateAll()) {
      this.showError("Fix the highlighted fields before placing the basket.");
      return;
    }
    this.confirmView.show(this.builder.rows);
  }

  countryId() {
    return parseInt($("#basketCountryId").val(), 10) || 1;
  }

  submit() {
    var submittedRows = this.builder.rows.slice();
    var orders = submittedRows.map((row) => row.toRequestBody(this.countryId()));
    var $button = $("#placeBasketBtn").prop("disabled", true).text("Placing…");
    callBeyondlyApi("POST", "/trading/orders/basket/", { body: { orders: orders } })
      .done((response) => this.onSubmitted(submittedRows, response))
      .fail((jqXHR) => this.onSubmitFailed(submittedRows, jqXHR))
      .always(() => $button.prop("disabled", false).text("Place Orders"));
  }

  // Keeps only the rows whose orders failed, so the user can retry them.
  onSubmitted(submittedRows, response) {
    this.confirmView.hide();
    this.resultsView.render(response);
    var failedRows = submittedRows.filter((row, index) => response.orders[index].status !== "success");
    this.builder.replaceRows(failedRows.map((row) => row.readValues()));
  }

  // A 502 with per-order results means every leg was rejected by the broker.
  onSubmitFailed(submittedRows, jqXHR) {
    this.confirmView.hide();
    if (jqXHR.responseJSON && jqXHR.responseJSON.orders) {
      this.onSubmitted(submittedRows, jqXHR.responseJSON);
      return;
    }
    this.showError(extractApiErrorMessage(jqXHR));
  }
}

$(function () {
  if (!requireSignedInUser()) {
    return;
  }
  new BasketOrderPage().start();
});
