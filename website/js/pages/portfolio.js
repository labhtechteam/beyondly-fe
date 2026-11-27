// Copy shown under the totals and in the empty state, per tab.
var PORTFOLIO_TABS = {
  holdings: {
    note: "Settled shares you own. P&L is measured from your average buy price to the last traded price.",
    emptyTitle: "No holdings yet",
    emptyText: "Stocks you buy will show up here once they settle.",
  },
  positions: {
    note: "Orders you've placed. Shares bought today move to Holdings once they settle.",
    emptyTitle: "No positions today",
    emptyText: "Stocks you buy or sell today will show up here.",
  },
};


// Number formatting for portfolio figures; the API sends them as strings.
class PortfolioFormat {
  static quantity(value) {
    var number = Number(value);
    if (value === null || !isFinite(number)) {
      return "—";
    }
    return number.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  static money(value) {
    var number = Number(value);
    if (value === null || value === undefined || !isFinite(number)) {
      return "—";
    }
    var amount = Math.abs(number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (number < 0 ? "-$" : "$") + amount;
  }

  static signedMoney(value) {
    var number = Number(value);
    return (number > 0 ? "+" : "") + PortfolioFormat.money(value);
  }

  // P&L with its percentage underneath, coloured by direction.
  static pnlHtml(pnl, percent) {
    var number = Number(pnl) || 0;
    var direction = number < 0 ? "down" : "up";
    var percentText = percent == null ? "" : (Number(percent) > 0 ? "+" : "") + Number(percent).toFixed(2) + "%";
    return (
      "<span class='change-" + direction + " fw-semibold'>" + PortfolioFormat.signedMoney(pnl) + "</span>" +
      "<span class='pf-sub change-" + direction + "'>" + percentText + "</span>"
    );
  }
}


// The stock table for whichever tab is selected.
class PortfolioTable {
  constructor() {
    this.showSellAction = true;
  }

  render(rows, showSellAction) {
    this.showSellAction = showSellAction;
    $("#portfolioActionHeader").toggleClass("d-none", !showSellAction);
    $("#portfolioTableBody").html(rows.map(this.rowHtml.bind(this)).join(""));
    $("#portfolioTableWrap").toggleClass("d-none", rows.length === 0);
    $("#portfolioEmptyState").toggleClass("d-none", rows.length > 0);
  }

  rowHtml(row) {
    return (
      "<tr data-symbol='" + MarketFormat.escape(row.symbol) + "'>" +
      "<td>" + this.stockCellHtml(row) + "</td>" +
      "<td class='text-end'>" + PortfolioFormat.quantity(row.quantity) + "</td>" +
      "<td class='text-end'>" + PortfolioFormat.money(row.avg_price) + "</td>" +
      "<td class='text-end'>" + PortfolioFormat.money(row.last_price) + "</td>" +
      "<td class='text-end'>" + PortfolioFormat.money(row.invested) + "</td>" +
      "<td class='text-end'>" + PortfolioFormat.pnlHtml(row.pnl, row.pnl_percent) + "</td>" +
      this.sellCellHtml() +
      "</tr>"
    );
  }

  sellCellHtml() {
    if (!this.showSellAction) {
      return "";
    }
    return "<td class='text-end'><button type='button' class='btn btn-outline-custom btn-sm sell-holding-btn'>Sell</button></td>";
  }

  stockCellHtml(row) {
    var showName = row.name && row.name !== row.symbol;
    return (
      "<div class='pf-stock'>" + MarketFormat.avatarHtml(row.symbol) + "<div>" +
      "<div class='fw-semibold'>" + MarketFormat.escape(row.symbol) + "</div>" +
      (showName ? "<span class='pf-sub'>" + MarketFormat.escape(row.name) + "</span>" : "") +
      "</div></div>"
    );
  }
}


// Total cost and total P&L for the selected tab.
class PortfolioTotalsStrip {
  render(totals) {
    $("#totalCostValue").text(PortfolioFormat.money(totals.invested));
    $("#totalPnlValue").html(PortfolioFormat.pnlHtml(totals.pnl, totals.pnl_percent));
  }

  clear() {
    $("#totalCostValue, #totalPnlValue").text("—");
  }
}


// The user's orders, listed under the Positions tab with Modify/Cancel actions.
class PortfolioOrdersList {
  constructor() {
    this.manageableStatuses = ["pending", "success", "modified"];
  }

  start() {
    var list = this;
    $("#refreshOrdersButton").on("click", function () { list.load(); });
    $("#ordersTableBody")
      .on("click", ".cancel-order-btn", function () { list.cancel($(this).data("order-id")); })
      .on("click", ".modify-order-btn", function () { list.modify($(this).data("order-id"), $(this).data("quantity")); });
  }

  load() {
    var list = this;
    $("#ordersErrorAlert").addClass("d-none");
    callBeyondlyApi("GET", "/trading/orders/")
      .done(function (response) { list.render(response.results || []); })
      .fail(function (jqXHR) { list.showError(extractApiErrorMessage(jqXHR)); });
  }

  render(orders) {
    $("[data-tab-count='positions']").text(orders.length);
    $("#ordersTableBody").html(orders.map(this.rowHtml.bind(this)).join(""));
    $("#noOrdersMessage").toggleClass("d-none", orders.length > 0);
  }

  showError(message) {
    $("#ordersErrorAlert").text(message).removeClass("d-none");
  }

  rowHtml(order) {
    var sideClass = order.order_type === "buy" ? "pill-buy" : "pill-sell";
    var isFailed = order.status === "cancelled" || order.status === "failure";
    return (
      "<tr><td class='fw-semibold'>" + MarketFormat.escape(order.symbol) + "</td>" +
      "<td><span class='pill " + sideClass + "'>" + order.order_type + "</span></td>" +
      "<td>" + order.order_category + "</td>" +
      "<td>" + order.quantity + "</td>" +
      "<td>$" + order.total_value + "</td>" +
      "<td><span class='pill " + (isFailed ? "pill-sell" : "pill-approved") + "'>" + order.status + "</span></td>" +
      "<td class='text-end text-nowrap'>" + this.actionsHtml(order) + "</td></tr>"
    );
  }

  actionsHtml(order) {
    var canManage = this.manageableStatuses.indexOf(order.status) !== -1 && order.broker_order_id;
    if (!canManage) {
      return "<span class='text-muted-custom small'>—</span>";
    }
    return (
      "<button type='button' class='btn btn-outline-custom btn-sm me-2 modify-order-btn' data-order-id='" + order.id + "' data-quantity='" + order.quantity + "'>Modify</button>" +
      "<button type='button' class='btn btn-outline-custom btn-sm cancel-order-btn' data-order-id='" + order.id + "'>Cancel</button>"
    );
  }

  cancel(orderId) {
    if (!confirm("Cancel this order?")) {
      return;
    }
    this.post("/trading/orders/cancel/", { order_id: orderId });
  }

  modify(orderId, currentQuantity) {
    var newQuantity = parseFloat(prompt("New quantity:", currentQuantity));
    if (!(newQuantity > 0)) {
      return;
    }
    this.post("/trading/orders/modify/", { order_id: orderId, quantity: newQuantity });
  }

  post(path, body) {
    var list = this;
    callBeyondlyApi("POST", path, { body: body })
      .done(function () { list.load(); })
      .fail(function (jqXHR) { list.showError(extractApiErrorMessage(jqXHR)); });
  }
}


// Modal for selling some or all of a holding.
class SellOrderModal {
  constructor(onOrderPlaced) {
    this.row = null;
    this.onOrderPlaced = onOrderPlaced;
    this.modal = new bootstrap.Modal(document.getElementById("sellOrderModal"));
  }

  start() {
    var sellModal = this;
    $("#sellCategory").on("change", function () { sellModal.toggleLimitPrice(); });
    $("#sellOrderForm").on("submit", function (event) {
      event.preventDefault();
      sellModal.submit();
    });
  }

  open(row) {
    this.row = row;
    $("#sellOrderTitle").text("Sell " + row.symbol);
    $("#sellHeldQuantity").text(PortfolioFormat.quantity(row.quantity));
    $("#sellLastPrice").text(PortfolioFormat.money(row.last_price));
    $("#sellQuantity").val(Number(row.quantity)).attr("max", row.quantity);
    $("#sellCategory").val("market_price");
    $("#sellLimitPrice").val(row.last_price ? Number(row.last_price).toFixed(2) : "");
    $("#sellOrderError").addClass("d-none");
    this.toggleLimitPrice();
    this.modal.show();
  }

  toggleLimitPrice() {
    $("#sellLimitPriceGroup").toggleClass("d-none", $("#sellCategory").val() !== "limit");
  }

  validationError() {
    var quantity = parseFloat($("#sellQuantity").val());
    if (!(quantity > 0)) {
      return "Quantity must be greater than zero.";
    }
    if (quantity > Number(this.row.quantity)) {
      return "You can sell at most " + PortfolioFormat.quantity(this.row.quantity) + " shares.";
    }
    if ($("#sellCategory").val() === "limit" && !(parseFloat($("#sellLimitPrice").val()) > 0)) {
      return "Enter a valid limit price.";
    }
    return "";
  }

  requestBody() {
    var body = {
      symbol: this.row.symbol, order_type: "sell", order_category: $("#sellCategory").val(),
      exchange_name: $("#sellExchange").val(), country_id: 1,
      quantity: parseFloat($("#sellQuantity").val()), validity: $("#sellValidity").val(),
    };
    if (body.order_category === "limit") {
      body.limit_price = parseFloat($("#sellLimitPrice").val());
    }
    return body;
  }

  submit() {
    var error = this.validationError();
    if (error) {
      return this.showError(error);
    }
    var sellModal = this;
    var $submitButton = $("#sellOrderSubmitButton").prop("disabled", true);
    callBeyondlyApi("POST", "/trading/orders/place/", { body: this.requestBody() })
      .done(function () { sellModal.modal.hide(); sellModal.onOrderPlaced(); })
      .fail(function (jqXHR) { sellModal.showError(extractApiErrorMessage(jqXHR)); })
      .always(function () { $submitButton.prop("disabled", false); });
  }

  showError(message) {
    $("#sellOrderError").text(message).removeClass("d-none");
  }
}


// Loads the portfolio once and switches between the Holdings and Positions tabs.
class PortfolioPage {
  constructor() {
    this.portfolio = null;
    this.selectedTab = "holdings";
    this.table = new PortfolioTable();
    this.totals = new PortfolioTotalsStrip();
    this.orders = new PortfolioOrdersList();
    this.sellModal = new SellOrderModal(this.onSellOrderPlaced.bind(this));
  }

  start() {
    var page = this;
    $("#portfolioTabs").on("click", "button", function () { page.selectTab($(this).data("tab")); });
    $("#portfolioRefreshButton").on("click", function () { page.load(); });
    this.bindTableClicks();
    this.orders.start();
    this.sellModal.start();
    this.selectTab(this.tabFromUrl());
    this.load();
  }

  bindTableClicks() {
    var page = this;
    $("#portfolioTableBody")
      .on("click", ".sell-holding-btn", function (event) {
        event.stopPropagation();
        page.openSellModal($(this).closest("tr").data("symbol"));
      })
      .on("click", "tr", function () {
        window.location.href = "stock.html?symbol=" + encodeURIComponent($(this).data("symbol"));
      });
  }

  tabFromUrl() {
    var tab = new URLSearchParams(window.location.search).get("tab");
    return PORTFOLIO_TABS[tab] ? tab : "holdings";
  }

  openSellModal(symbol) {
    var row = this.portfolio.holdings.rows.find(function (holding) { return holding.symbol === String(symbol); });
    if (row) {
      this.sellModal.open(row);
    }
  }

  onSellOrderPlaced() {
    this.selectTab("positions");
    this.load();
  }

  load() {
    var page = this;
    var $refreshButton = $("#portfolioRefreshButton").prop("disabled", true);
    $("#portfolioErrorAlert").addClass("d-none");
    this.orders.load();
    callBeyondlyApi("GET", "/trading/portfolio/")
      .done(function (response) { page.showPortfolio(response); })
      .fail(function (jqXHR) { page.showError(extractApiErrorMessage(jqXHR)); })
      .always(function () { $refreshButton.prop("disabled", false); });
  }

  showPortfolio(portfolio) {
    this.portfolio = portfolio;
    $("[data-tab-count='holdings']").text(portfolio.holdings.rows.length);
    this.render();
  }

  showError(message) {
    $("#portfolioErrorAlert").text(message).removeClass("d-none");
    this.totals.clear();
  }

  selectTab(tab) {
    var copy = PORTFOLIO_TABS[tab];
    this.selectedTab = tab;
    $("#positionsOrdersSection").toggleClass("d-none", tab !== "positions");
    $("#portfolioTabs button").removeClass("active").filter("[data-tab='" + tab + "']").addClass("active");
    $("#portfolioTabNote").text(copy.note);
    $("#portfolioEmptyTitle").text(copy.emptyTitle);
    $("#portfolioEmptyText").text(copy.emptyText);
    this.render();
  }

  render() {
    var showsOrdersOnly = this.selectedTab === "positions";
    $(".pf-totals").toggleClass("d-none", showsOrdersOnly);
    if (showsOrdersOnly) {
      $("#portfolioTableWrap, #portfolioEmptyState").addClass("d-none");
      return;
    }
    if (!this.portfolio) {
      return;
    }
    var tab = this.portfolio[this.selectedTab];
    this.table.render(tab.rows, this.selectedTab === "holdings");
    this.totals.render(tab.totals);
  }
}


$(function () {
  if (!requireSignedInUser()) {
    return;
  }
  new PortfolioPage().start();
});
