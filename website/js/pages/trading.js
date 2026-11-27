var selectedOrderSide = "buy";

function showOrderError(message) {
  $("#orderErrorAlert").text(message).removeClass("d-none");
}

function hideOrderError() {
  $("#orderErrorAlert").addClass("d-none");
}

// Switches the Buy/Sell segmented control and updates the submit button label.
function selectOrderSide(side) {
  selectedOrderSide = side;
  $("#orderSideTabs .seg-btn").removeClass("active");
  $('#orderSideTabs .seg-btn[data-side="' + side + '"]').addClass("active");
  $("#submitOrderBtn").text("Place " + (side === "buy" ? "Buy" : "Sell") + " Order");
}

// Shows the limit/stop price fields relevant to the selected order category.
function toggleOrderCategoryFields() {
  var category = $("#orderCategory").val();
  $("#limitPriceGroup").toggleClass("d-none", category !== "limit" && category !== "stop_limit");
  $("#stopPriceGroup").toggleClass("d-none", category !== "stop" && category !== "stop_limit");
  $("#orderQuantityLabel").text(category === "fractional" ? "Amount ($)" : "Quantity");
}

// Validates the order form and returns true only if every field is valid.
function validateOrderForm() {
  var isValid = true;
  var category = $("#orderCategory").val();
  var quantity = parseFloat($("#orderQuantity").val());
  var limitPrice = parseFloat($("#orderLimitPrice").val());
  var stopPrice = parseFloat($("#orderStopPrice").val());

  $(".field-error").hide();

  if (!$("#orderSymbol").val().trim()) {
    $("#orderSymbolError").show();
    isValid = false;
  }
  if (!quantity || quantity <= 0) {
    $("#orderQuantityError").show();
    isValid = false;
  }
  if ((category === "limit" || category === "stop_limit") && (!limitPrice || limitPrice <= 0)) {
    $("#orderLimitPriceError").show();
    isValid = false;
  }
  if ((category === "stop" || category === "stop_limit") && (!stopPrice || stopPrice <= 0)) {
    $("#orderStopPriceError").show();
    isValid = false;
  }

  return isValid;
}

// Builds the request body for POST /trading/orders/place/ from the current form.
function buildPlaceOrderBody() {
  var category = $("#orderCategory").val();
  var body = {
    symbol: $("#orderSymbol").val().trim().toUpperCase(),
    order_type: selectedOrderSide,
    order_category: category,
    exchange_name: $("#orderExchange").val(),
    country_id: parseInt($("#orderCountryId").val(), 10),
    quantity: parseFloat($("#orderQuantity").val()),
  };

  if (category === "limit" || category === "stop_limit") {
    body.limit_price = parseFloat($("#orderLimitPrice").val());
  }
  if (category === "stop" || category === "stop_limit") {
    body.stop_price = parseFloat($("#orderStopPrice").val());
  }

  return body;
}

// Shows the success alert briefly after an order is placed.
function showOrderSuccessAlert() {
  var $alert = $("#orderSuccessAlert");
  $alert.removeClass("d-none");
  setTimeout(function () {
    $alert.addClass("d-none");
  }, 3000);
}

function bindOrderSideTabs() {
  $("#orderSideTabs .seg-btn").on("click", function () {
    selectOrderSide($(this).data("side"));
  });
}

function bindOrderCategoryChange() {
  $("#orderCategory").on("change", toggleOrderCategoryFields);
}

var QUOTE_REFRESH_INTERVAL_MS = 15000;

// Fetches the selected symbol's quote, shows it, and refreshes it while the tab is visible.
class TradingQuotePanel {
  constructor(quoteService, onPriceChange) {
    this.quoteService = quoteService;
    this.onPriceChange = onPriceChange;
    this.symbol = "";
    this.lastPrice = null;
    this.refreshTimer = null;
  }

  load(rawSymbol) {
    var symbol = String(rawSymbol || "").trim().toUpperCase();
    if (symbol === this.symbol) return;
    this.symbol = symbol;
    clearInterval(this.refreshTimer);
    this.setPrice(null);
    if (!symbol) {
      $("#tradeQuotePanel").addClass("d-none");
      return;
    }
    this.showLoading();
    this.fetch();
    this.refreshTimer = setInterval(() => this.fetch(), QUOTE_REFRESH_INTERVAL_MS);
  }

  fetch() {
    var symbol = this.symbol;
    if (document.hidden) return;
    this.quoteService.fetchQuotes([symbol])
      .done((quotes) => { if (symbol === this.symbol) this.render(this.findQuote(quotes)); })
      .fail((jqXHR) => { if (symbol === this.symbol) this.showStatus(extractApiErrorMessage(jqXHR)); });
  }

  findQuote(quotes) {
    var match = quotes.find((quote) => String(quote.symbol).toUpperCase() === this.symbol);
    return match || quotes[0];
  }

  render(quote) {
    if (!quote || !(Number(quote.lastPrice) > 0)) {
      this.showStatus("No market price available for " + this.symbol + ".");
      return;
    }
    $("#tradeQuoteCompany").text(MarketFormat.displayName(quote) === quote.symbol ? "" : MarketFormat.displayName(quote));
    $("#tradeQuotePrice").text(MarketFormat.price(quote.lastPrice));
    $("#tradeQuoteChange").html(MarketFormat.changeHtml(quote));
    this.showStatus("Updated " + new Date().toLocaleTimeString() + " · refreshes every 15s");
    this.setPrice(Number(quote.lastPrice));
  }

  showLoading() {
    $("#tradeQuoteSymbol").text(this.symbol);
    $("#tradeQuoteCompany").text("");
    $("#tradeQuotePrice").text("—");
    $("#tradeQuoteChange").empty();
    this.showStatus("Fetching market price…");
    $("#tradeQuotePanel").removeClass("d-none");
  }

  showStatus(message) {
    $("#tradeQuoteStatus").text(message);
  }

  setPrice(price) {
    this.lastPrice = price;
    this.onPriceChange();
  }
}

// Works out the order's estimated total from quantity and the relevant price.
class OrderTotalEstimate {
  constructor(quotePanel) {
    this.quotePanel = quotePanel;
  }

  refresh() {
    var estimate = this.calculate();
    $("#orderTotalLabel").text(selectedOrderSide === "buy" ? "Estimated cost" : "Estimated proceeds");
    $("#orderTotalValue").text(estimate.total === null ? "—" : OrderTotalEstimate.formatMoney(estimate.total));
    $("#orderTotalBasis").text(estimate.basis);
  }

  static formatMoney(amount) {
    return "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  calculate() {
    var category = $("#orderCategory").val();
    var quantity = parseFloat($("#orderQuantity").val());
    if (!(quantity > 0)) return { total: null, basis: "Enter a quantity" };
    if (category === "fractional") return this.fractionalEstimate(quantity);
    var pricing = this.pricingFor(category);
    if (!pricing.price) return { total: null, basis: pricing.missingMessage };
    var basis = quantity + " × " + MarketFormat.price(pricing.price) + " " + pricing.label;
    return { total: quantity * pricing.price, basis: basis };
  }

  // Limit orders are valued at the limit, stop orders at the stop, the rest at market.
  pricingFor(category) {
    if (category === "limit" || category === "stop_limit") {
      return { price: parseFloat($("#orderLimitPrice").val()) || null, label: "(limit price)", missingMessage: "Enter a limit price" };
    }
    if (category === "stop") {
      return { price: parseFloat($("#orderStopPrice").val()) || null, label: "(stop price)", missingMessage: "Enter a stop price" };
    }
    var missingMessage = this.quotePanel.symbol ? "Waiting for market price" : "Select a symbol";
    return { price: this.quotePanel.lastPrice, label: "(market price)", missingMessage: missingMessage };
  }

  fractionalEstimate(amount) {
    var price = this.quotePanel.lastPrice;
    var shares = price ? " ≈ " + (amount / price).toFixed(4) + " shares at " + MarketFormat.price(price) : "";
    return { total: amount, basis: "Dollar amount" + shares };
  }
}

// Loads the quote when the symbol changes and keeps the total in sync with the form.
function bindQuoteAndTotal() {
  var estimate = null;
  var quotePanel = new TradingQuotePanel(new QuoteService(), function () {
    if (estimate) estimate.refresh();
  });
  estimate = new OrderTotalEstimate(quotePanel);
  $("#orderSymbol").on("change", function () { quotePanel.load($(this).val()); });
  $("#orderForm").on("input change", function () { estimate.refresh(); });
  $("#orderSideTabs").on("click", function () { estimate.refresh(); });
  estimate.refresh();
}

// Suggests symbols as the user types and selects a matching exchange.
function bindSymbolAutocomplete() {
  var autocomplete = new SymbolAutocomplete("#orderSymbol", function (input, suggestion) {
    var exchangeName = suggestion.exchangeName();
    if (exchangeName) {
      $("#orderExchange").val(exchangeName);
    }
    $("#orderSymbolError").hide();
  });
  autocomplete.bind($("#orderForm"));
}

function bindOrderFormSubmit() {
  $("#orderForm").on("submit", function (event) {
    event.preventDefault();
    hideOrderError();

    if (!validateOrderForm()) {
      return;
    }

    var $submitBtn = $("#submitOrderBtn").prop("disabled", true);
    var formElement = this;

    callBeyondlyApi("POST", "/trading/orders/place/", { body: buildPlaceOrderBody() })
      .done(function () {
        showOrderSuccessAlert();
        formElement.reset();
        toggleOrderCategoryFields();
        $("#orderSymbol").trigger("change");
      })
      .fail(function (jqXHR) {
        showOrderError(extractApiErrorMessage(jqXHR));
      })
      .always(function () {
        $submitBtn.prop("disabled", false);
      });
  });
}

$(function () {
  if (!requireSignedInUser()) {
    return;
  }

  bindOrderSideTabs();
  bindOrderCategoryChange();
  bindSymbolAutocomplete();
  bindQuoteAndTotal();
  bindOrderFormSubmit();
});
