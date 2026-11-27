var REPORT_TYPES = {
  PNL: { title: "P&L Report", description: "Realized profit and loss for the chosen dates.", endpoint: "/ledger/reports/pnl/" },
  TAX: { title: "Tax Report", description: "Capital gains for the chosen dates, in INR and USD, split into short and long term.", endpoint: "/ledger/reports/tax/" },
  ORDERS: { title: "Order History", description: "Every order you placed in the chosen dates, newest first." },
};
var REPORT_TAB_QUERY_VALUES = { pnl: "PNL", tax: "TAX", orders: "ORDERS" };
var ORDER_STATUS_DISPLAY = {
  success: { label: "Placed", pillClass: "pill-approved" },
  pending: { label: "Pending", pillClass: "pill-pending" },
  modified: { label: "Modified", pillClass: "pill-review" },
  cancelled: { label: "Cancelled", pillClass: "pill-muted" },
  failure: { label: "Failed", pillClass: "pill-sell" },
};
var ORDER_CATEGORY_DISPLAY = {
  market_price: "Market", limit: "Limit", stop: "Stop", stop_limit: "Stop Limit", fractional: "Fractional",
};

function escapeReportHtml(text) {
  var html = $("<div>").text(text === null || text === undefined ? "" : String(text)).html();
  return html.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// The shared From / To inputs, defaulting to the last 30 days.
class ReportDateRange {
  setDefault() {
    var today = new Date();
    var monthAgo = new Date();
    monthAgo.setDate(today.getDate() - 30);
    $("#reportToDate").val(ReportDateRange.toInputValue(today));
    $("#reportFromDate").val(ReportDateRange.toInputValue(monthAgo));
  }

  static toInputValue(date) {
    var localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 10);
  }

  // Dates as the broker report endpoints expect them.
  dateQuery() {
    return { from_date: $("#reportFromDate").val(), to_date: $("#reportToDate").val() };
  }

  // Local midnight of From up to local midnight after To, so whole local days are included.
  instantQuery() {
    var from = $("#reportFromDate").val();
    var to = $("#reportToDate").val();
    var query = {};
    if (from) query.from = new Date(from + "T00:00:00").toISOString();
    if (to) {
      var dayAfterTo = new Date(to + "T00:00:00");
      dayAfterTo.setDate(dayAfterTo.getDate() + 1);
      query.to = dayAfterTo.toISOString();
    }
    return query;
  }
}

// Fee lines in the P&L breakdown: label and the broker's total field.
var PNL_FEE_LINES = [
  { label: "Commission", totalKey: "totalCommission", tradeKey: "commission" },
  { label: "SEC Fee", totalKey: "totalSecFee", tradeKey: "secFee" },
  { label: "IFSCA Fee", totalKey: "totalIfscaFee", tradeKey: "ifscaFee" },
  { label: "ECN Fee", totalKey: "totalEcnFee", tradeKey: "ecnFee" },
  { label: "TEFRA Fee", totalKey: "totalTefraFee", tradeKey: "tefraFee" },
  { label: "GST", totalKey: "totalGst", tradeKey: "gst" },
  { label: "Other", totalKey: "totalOthFee", tradeKey: "othFee" },
];

// Number and date formatting for P&L figures.
class PnlFormat {
  static money(value) {
    var number = Number(value);
    if (value === null || value === undefined || !isFinite(number)) return "—";
    var amount = Math.abs(number).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (number < 0 ? "-$" : "$") + amount;
  }

  static signedMoneyHtml(value) {
    var number = Number(value) || 0;
    var rounded = Math.round(number * 100) / 100;
    var direction = rounded > 0 ? "change-up" : rounded < 0 ? "change-down" : "text-muted-custom";
    var text = (rounded > 0 ? "+" : "") + PnlFormat.money(number);
    return "<span class='" + direction + " fw-semibold pnl-num'>" + escapeReportHtml(text) + "</span>";
  }

  static quantity(value) {
    return Number(value).toLocaleString("en-US", { maximumFractionDigits: 6 });
  }

  static date(isoDate) {
    if (!isoDate) return "—";
    var date = new Date(isoDate + "T00:00:00");
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  // The broker pads security names with runs of spaces.
  static securityName(name) {
    return (name || "").replace(/\s+/g, " ").trim();
  }
}

// Headline strip: realized P&L, fees, net, and trade counts.
class PnlSummaryView {
  render(report) {
    var trades = report.trades || [];
    var fees = Number(report.grandTotalFee) || 0;
    $("#pnlTotalValue").html(PnlFormat.signedMoneyHtml(report.totalPnl));
    $("#pnlFeesValue").text(PnlFormat.money(fees));
    $("#pnlNetValue").html(PnlFormat.signedMoneyHtml((Number(report.totalPnl) || 0) - fees));
    $("#pnlTradeCountValue").text(trades.length);
    $("#pnlWinLossValue").text(PnlSummaryView.winLossText(trades));
  }

  static winLossText(trades) {
    var winners = trades.filter((trade) => Number(trade.pnl) > 0).length;
    var losers = trades.filter((trade) => Number(trade.pnl) < 0).length;
    return winners + " profitable · " + losers + " at a loss";
  }
}

// One row per symbol, built from the broker's per-symbol totals.
class PnlSymbolTable {
  render(report) {
    var symbols = Object.keys(report.symbolTotals || {});
    symbols.sort((first, second) => report.symbolTotals[second] - report.symbolTotals[first]);
    var tradeCounts = PnlSymbolTable.countTrades(report.trades || []);
    var rows = symbols.map((symbol) => this.rowHtml(symbol, report, tradeCounts[symbol] || 0));
    $("#pnlSymbolBody").html(rows.join(""));
  }

  static countTrades(trades) {
    var counts = {};
    trades.forEach((trade) => { counts[trade.symbol] = (counts[trade.symbol] || 0) + 1; });
    return counts;
  }

  rowHtml(symbol, report, tradeCount) {
    var pnl = Number(report.symbolTotals[symbol]) || 0;
    var fees = Number((report.symbolTotalFee || {})[symbol]) || 0;
    return "<tr>" +
      "<td class='fw-semibold'><a href='stock.html?symbol=" + encodeURIComponent(symbol) + "'>" + escapeReportHtml(symbol) + "</a></td>" +
      "<td class='text-end pnl-num'>" + tradeCount + "</td>" +
      "<td class='text-end'>" + PnlFormat.signedMoneyHtml(pnl) + "</td>" +
      "<td class='text-end pnl-num text-muted-custom'>" + escapeReportHtml(PnlFormat.money(fees)) + "</td>" +
      "<td class='text-end'>" + PnlFormat.signedMoneyHtml(pnl - fees) + "</td>" +
      "</tr>";
  }
}

// Report-wide fee totals, with zero lines dimmed.
class PnlFeeBreakdown {
  render(report) {
    var items = PNL_FEE_LINES.map((line) => PnlFeeBreakdown.itemHtml(line.label, report[line.totalKey], ""));
    items.push(PnlFeeBreakdown.itemHtml("Total", report.grandTotalFee, "pnl-fee-total"));
    $("#pnlFeeList").html(items.join(""));
  }

  static itemHtml(label, value, extraClass) {
    var zeroClass = Number(value) ? "" : " pnl-fee-zero";
    return "<li class='" + extraClass + zeroClass + "'><span>" + escapeReportHtml(label) +
      "</span><span>" + escapeReportHtml(PnlFormat.money(value || 0)) + "</span></li>";
  }
}

// Individual closed trades, filterable by symbol.
class PnlTradesTable {
  constructor() {
    this.trades = [];
    $("#pnlSymbolFilter").on("input", () => this.render());
  }

  load(trades) {
    this.trades = trades;
    $("#pnlSymbolFilter").val("");
    this.render();
  }

  render() {
    var symbolText = $("#pnlSymbolFilter").val().trim().toUpperCase();
    var trades = this.trades.filter((trade) => !symbolText || trade.symbol.indexOf(symbolText) !== -1);
    $("#pnlTradesBody").html(trades.map((trade) => this.rowHtml(trade)).join(""));
    $("#pnlTradesEmpty").toggleClass("d-none", trades.length > 0);
  }

  rowHtml(trade) {
    var name = PnlFormat.securityName(trade.securityName);
    return "<tr>" +
      "<td><span class='fw-semibold'>" + escapeReportHtml(trade.symbol) + "</span>" +
        "<span class='pf-sub pnl-name' title='" + escapeReportHtml(name) + "'>" + escapeReportHtml(name) + "</span></td>" +
      "<td class='text-nowrap'>" + escapeReportHtml(PnlFormat.date(trade.buyDate)) + "</td>" +
      "<td class='text-nowrap'>" + escapeReportHtml(PnlFormat.date(trade.sellDate)) + "</td>" +
      "<td class='text-end pnl-num'>" + escapeReportHtml(PnlFormat.quantity(trade.qty)) + "</td>" +
      "<td class='text-end pnl-num'>" + escapeReportHtml(PnlFormat.money(trade.buyAmount)) + "</td>" +
      "<td class='text-end pnl-num'>" + escapeReportHtml(PnlFormat.money(trade.sellAmount)) + "</td>" +
      "<td class='text-end'>" + PnlFormat.signedMoneyHtml(trade.pnl) + "</td>" +
      this.feeCellHtml(trade) + "</tr>";
  }

  // Fee total, with the non-zero components listed in a hover tooltip.
  feeCellHtml(trade) {
    var parts = PNL_FEE_LINES
      .filter((line) => Number(trade[line.tradeKey]))
      .map((line) => line.label + ": " + PnlFormat.money(trade[line.tradeKey]));
    var tooltip = parts.length ? parts.join("\n") : "No fees";
    return "<td class='text-end pnl-num text-muted-custom'><span class='pnl-fee-cell' title='" +
      escapeReportHtml(tooltip) + "'>" + escapeReportHtml(PnlFormat.money(trade.totalFee)) + "</span></td>";
  }
}

// P&L tab: fetches the report and hands each section its slice of the data.
class PnlReportView {
  constructor() {
    this.summary = new PnlSummaryView();
    this.symbolTable = new PnlSymbolTable();
    this.feeBreakdown = new PnlFeeBreakdown();
    this.tradesTable = new PnlTradesTable();
  }

  run(query) {
    this.showMessage("Loading your P&L…");
    return callBeyondlyApi("GET", REPORT_TYPES.PNL.endpoint, { query: query })
      .then((response) => this.handleResponse(response))
      .fail((jqXHR) => this.showMessage("Couldn't load the P&L report: " + extractApiErrorMessage(jqXHR)));
  }

  handleResponse(response) {
    if (BrokerReportResponse.isFailure(response)) return BrokerReportResponse.rejection(response);
    this.render(response.data || {});
    return response;
  }

  render(report) {
    if (!(report.trades || []).length) {
      this.showMessage("No closed trades in this date range.");
      return;
    }
    this.summary.render(report);
    this.symbolTable.render(report);
    this.feeBreakdown.render(report);
    this.tradesTable.load(report.trades);
    $("#pnlReportMessage").addClass("d-none");
    $("#pnlReportContent").removeClass("d-none");
  }

  showMessage(message) {
    $("#pnlReportContent").addClass("d-none");
    $("#pnlReportMessage").text(message).removeClass("d-none");
  }

  reset() {
    this.showMessage("Choose a date range and run a report.");
  }
}

// The broker signals failure with a non-"00" code inside a 200 response.
class BrokerReportResponse {
  static isFailure(response) {
    return Boolean(response.code) && response.code !== "00";
  }

  // A rejected promise shaped like a jqXHR so extractApiErrorMessage can read it.
  static rejection(response) {
    var message = response.message || "The broker couldn't generate this report.";
    return $.Deferred().reject({ responseJSON: { error: message } }).promise();
  }
}

// Holding-period sections in the tax report and their broker field names.
var TAX_TERMS = {
  stcg: { label: "short-term", tradesKey: "stcgTrades", perSecurityKey: "stcgPerSecurity" },
  ltcg: { label: "long-term", tradesKey: "ltcgTrades", perSecurityKey: "ltcgPerSecurity" },
};

// Rupee formatting on top of the shared P&L formatters.
class TaxFormat {
  static inr(value) {
    var number = Number(value);
    if (value === null || value === undefined || !isFinite(number)) return "—";
    var amount = Math.abs(number).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (number < 0 ? "-₹" : "₹") + amount;
  }

  static signedInrHtml(value) {
    var rounded = Math.round((Number(value) || 0) * 100) / 100;
    var direction = rounded > 0 ? "change-up" : rounded < 0 ? "change-down" : "text-muted-custom";
    var text = (rounded > 0 ? "+" : "") + TaxFormat.inr(rounded);
    return "<span class='" + direction + " fw-semibold pnl-num'>" + escapeReportHtml(text) + "</span>";
  }

  static signedUsd(value) {
    var number = Number(value) || 0;
    return (Math.round(number * 100) > 0 ? "+" : "") + PnlFormat.money(number);
  }

  static holdingDays(days) {
    var count = Number(days) || 0;
    return count + (count === 1 ? " day" : " days");
  }
}

// Headline strip: STCG, LTCG and their total, in INR with USD underneath.
class TaxSummaryView {
  render(report) {
    var stcgInr = Number(report.totalStcgGainLossInr) || 0;
    var ltcgInr = Number(report.totalLtcgGainLossInr) || 0;
    var stcgUsd = Number(report.totalStcgGainLoss) || 0;
    var ltcgUsd = Number(report.totalLtcgGainLoss) || 0;
    TaxSummaryView.setFigure("Stcg", stcgInr, stcgUsd);
    TaxSummaryView.setFigure("Ltcg", ltcgInr, ltcgUsd);
    TaxSummaryView.setFigure("Total", stcgInr + ltcgInr, stcgUsd + ltcgUsd);
  }

  static setFigure(idPart, inrValue, usdValue) {
    $("#tax" + idPart + "Value").html(TaxFormat.signedInrHtml(inrValue));
    $("#tax" + idPart + "UsdValue").text(TaxFormat.signedUsd(usdValue) + " USD");
  }
}

// One row per security, merging the short- and long-term per-security maps.
class TaxSecurityTable {
  render(report) {
    var symbols = TaxSecurityTable.allSymbols(report);
    var rows = symbols.map((symbol) => this.rowFigures(symbol, report));
    rows.sort((first, second) => second.totalInr - first.totalInr);
    $("#taxSecurityBody").html(rows.map((row) => this.rowHtml(row)).join(""));
  }

  static allSymbols(report) {
    var keys = Object.keys(report.stcgPerSecurity || {}).concat(Object.keys(report.ltcgPerSecurity || {}));
    return keys.filter((symbol, index) => keys.indexOf(symbol) === index);
  }

  rowFigures(symbol, report) {
    var figures = { symbol: symbol };
    ["stcg", "ltcg"].forEach((term) => {
      figures[term + "Usd"] = Number((report[term + "PerSecurity"] || {})[symbol]) || 0;
      figures[term + "Inr"] = Number((report[term + "PerSecurityInr"] || {})[symbol]) || 0;
    });
    figures.totalUsd = figures.stcgUsd + figures.ltcgUsd;
    figures.totalInr = figures.stcgInr + figures.ltcgInr;
    return figures;
  }

  rowHtml(row) {
    return "<tr>" +
      "<td class='fw-semibold'><a href='stock.html?symbol=" + encodeURIComponent(row.symbol) + "'>" + escapeReportHtml(row.symbol) + "</a></td>" +
      TaxSecurityTable.amountCellHtml(row.stcgInr, row.stcgUsd) +
      TaxSecurityTable.amountCellHtml(row.ltcgInr, row.ltcgUsd) +
      TaxSecurityTable.amountCellHtml(row.totalInr, row.totalUsd) +
      "</tr>";
  }

  static amountCellHtml(inrValue, usdValue) {
    return "<td class='text-end'>" + TaxFormat.signedInrHtml(inrValue) +
      "<span class='tax-sub'>" + escapeReportHtml(TaxFormat.signedUsd(usdValue)) + "</span></td>";
  }
}

// Advance-tax periods, in the order the broker sends them.
class TaxQuarterTable {
  render(report) {
    var breakup = report.quarterlyBreakup || {};
    var stcg = breakup.stcgInr || {};
    var ltcg = breakup.ltcgInr || {};
    var periods = Object.keys(stcg).length ? Object.keys(stcg) : Object.keys(ltcg);
    $("#taxQuarterBody").html(periods.map((period) => this.rowHtml(period, stcg[period], ltcg[period])).join(""));
  }

  rowHtml(period, stcgValue, ltcgValue) {
    return "<tr>" +
      "<td class='text-nowrap'>" + escapeReportHtml(period) + "</td>" +
      "<td class='text-end'>" + TaxFormat.signedInrHtml(stcgValue) + "</td>" +
      "<td class='text-end'>" + TaxFormat.signedInrHtml(ltcgValue) + "</td>" +
      "</tr>";
  }
}

// Trades for the selected holding period, filterable by symbol.
class TaxTradesTable {
  constructor() {
    this.report = {};
    this.term = "stcg";
    $("#taxSymbolFilter").on("input", () => this.render());
    $("#taxTermTabs").on("click", ".seg-btn", (event) => this.selectTerm($(event.currentTarget).data("term")));
  }

  load(report) {
    this.report = report;
    $("#taxStcgCount").text((report.stcgTrades || []).length);
    $("#taxLtcgCount").text((report.ltcgTrades || []).length);
    $("#taxSymbolFilter").val("");
    this.selectTerm((report.stcgTrades || []).length ? "stcg" : "ltcg");
  }

  selectTerm(term) {
    this.term = term;
    $("#taxTermTabs .seg-btn").removeClass("active");
    $('#taxTermTabs .seg-btn[data-term="' + term + '"]').addClass("active");
    this.render();
  }

  render() {
    var symbolText = $("#taxSymbolFilter").val().trim().toUpperCase();
    var allTrades = this.report[TAX_TERMS[this.term].tradesKey] || [];
    var trades = allTrades.filter((trade) => !symbolText || trade.symbol.indexOf(symbolText) !== -1);
    $("#taxTradesBody").html(trades.map((trade) => this.rowHtml(trade)).join(""));
    $("#taxTradesEmpty").text(this.emptyText(allTrades.length)).toggleClass("d-none", trades.length > 0);
  }

  emptyText(termTradeCount) {
    if (termTradeCount) return "No trades match this symbol.";
    return "No " + TAX_TERMS[this.term].label + " trades in this date range.";
  }

  rowHtml(trade) {
    var name = PnlFormat.securityName(trade.securityName);
    return "<tr>" +
      "<td><span class='fw-semibold'>" + escapeReportHtml(trade.symbol) + "</span>" +
        "<span class='pf-sub pnl-name' title='" + escapeReportHtml(name) + "'>" + escapeReportHtml(name) + "</span></td>" +
      TaxTradesTable.dateCellHtml(trade.buyDate, trade.buyFxRate) +
      TaxTradesTable.dateCellHtml(trade.sellDate, trade.sellFxRate) +
      "<td class='text-end text-nowrap'>" + escapeReportHtml(TaxFormat.holdingDays(trade.holdingDays)) + "</td>" +
      "<td class='text-end pnl-num'>" + escapeReportHtml(PnlFormat.quantity(trade.qty)) + "</td>" +
      TaxTradesTable.valueCellHtml(trade.buyAmount, trade.buyAmountInr) +
      TaxTradesTable.valueCellHtml(trade.sellAmount, trade.sellAmountInr) +
      TaxTradesTable.gainCellHtml(trade) + "</tr>";
  }

  static dateCellHtml(isoDate, fxRate) {
    var rateText = fxRate ? "@ ₹" + Number(fxRate).toFixed(2) : "";
    return "<td class='text-nowrap'>" + escapeReportHtml(PnlFormat.date(isoDate)) +
      "<span class='tax-sub'>" + escapeReportHtml(rateText) + "</span></td>";
  }

  static valueCellHtml(usdValue, inrValue) {
    return "<td class='text-end pnl-num'>" + escapeReportHtml(PnlFormat.money(usdValue)) +
      "<span class='tax-sub'>" + escapeReportHtml(TaxFormat.inr(inrValue)) + "</span></td>";
  }

  static gainCellHtml(trade) {
    return "<td class='text-end'>" + TaxFormat.signedInrHtml(trade.gainLossInr) +
      "<span class='tax-sub'>" + escapeReportHtml(TaxFormat.signedUsd(trade.gainLoss)) + "</span></td>";
  }
}

// Tax tab: fetches the capital-gains report and hands each section its data.
class TaxReportView {
  constructor() {
    this.summary = new TaxSummaryView();
    this.securityTable = new TaxSecurityTable();
    this.quarterTable = new TaxQuarterTable();
    this.tradesTable = new TaxTradesTable();
  }

  run(query) {
    this.showMessage("Loading your tax report…");
    return callBeyondlyApi("GET", REPORT_TYPES.TAX.endpoint, { query: query })
      .then((response) => this.handleResponse(response))
      .fail((jqXHR) => this.showMessage("Couldn't load the tax report: " + extractApiErrorMessage(jqXHR)));
  }

  handleResponse(response) {
    if (BrokerReportResponse.isFailure(response)) return BrokerReportResponse.rejection(response);
    this.render(response.data || {});
    return response;
  }

  render(report) {
    var tradeCount = (report.stcgTrades || []).length + (report.ltcgTrades || []).length;
    if (!tradeCount) {
      this.showMessage("No capital gains in this date range.");
      return;
    }
    this.summary.render(report);
    this.securityTable.render(report);
    this.quarterTable.render(report);
    this.tradesTable.load(report);
    $("#taxReportMessage").addClass("d-none");
    $("#taxReportContent").removeClass("d-none");
  }

  showMessage(message) {
    $("#taxReportContent").addClass("d-none");
    $("#taxReportMessage").text(message).removeClass("d-none");
  }

  reset() {
    this.showMessage("Choose a date range and run a report.");
  }
}

// Order history table with client-side symbol / side / status filters.
class OrderHistoryView {
  constructor() {
    this.orders = [];
    $("#orderHistorySymbolFilter, #orderHistorySideFilter, #orderHistoryStatusFilter")
      .on("input change", () => this.render());
  }

  load(query) {
    this.showMessage("Loading orders…");
    $("#orderHistoryBody").empty();
    $("#orderHistorySummary").text("");
    return callBeyondlyApi("GET", "/trading/orders/", { query: query })
      .done((response) => {
        this.orders = response.results || [];
        this.render();
      })
      .fail(() => this.showMessage("Could not load your orders."));
  }

  filteredOrders() {
    var symbolText = $("#orderHistorySymbolFilter").val().trim().toUpperCase();
    var side = $("#orderHistorySideFilter").val();
    var status = $("#orderHistoryStatusFilter").val();
    return this.orders.filter((order) =>
      (!symbolText || order.symbol.indexOf(symbolText) !== -1) &&
      (!side || order.order_type === side) &&
      (!status || order.status === status));
  }

  render() {
    var orders = this.filteredOrders();
    $("#orderHistoryBody").html(orders.map((order) => this.rowHtml(order)).join(""));
    $("#orderHistorySummary").text(this.summaryText(orders));
    if (orders.length) {
      $("#orderHistoryEmpty").addClass("d-none");
      return;
    }
    this.showMessage(this.orders.length ? "No orders match these filters." : "No orders in this date range.");
  }

  summaryText(orders) {
    var placedCount = orders.filter((order) => order.status === "success").length;
    var shownText = orders.length === this.orders.length ? "" : " of " + this.orders.length;
    return orders.length + shownText + " orders · " + placedCount + " placed";
  }

  showMessage(message) {
    $("#orderHistoryEmpty").text(message).removeClass("d-none");
  }

  rowHtml(order) {
    var status = ORDER_STATUS_DISPLAY[order.status] || { label: order.status, pillClass: "pill-muted" };
    var sideClass = order.order_type === "buy" ? "pill-buy" : "pill-sell";
    var detail = order.status === "failure" ? order.reason : order.broker_order_id;
    return "<tr>" +
      "<td class='text-nowrap'>" + escapeReportHtml(OrderHistoryView.formatDate(order.created_at)) + "</td>" +
      "<td class='fw-semibold'>" + escapeReportHtml(order.symbol) + "</td>" +
      "<td><span class='pill " + sideClass + "'>" + escapeReportHtml(order.order_type.toUpperCase()) + "</span></td>" +
      "<td class='text-nowrap'>" + escapeReportHtml(ORDER_CATEGORY_DISPLAY[order.order_category] || order.order_category) + "</td>" +
      "<td class='text-end'>" + escapeReportHtml(OrderHistoryView.formatQuantity(order)) + "</td>" +
      "<td class='text-end'>" + escapeReportHtml(OrderHistoryView.formatMoney(order.limit_price)) + "</td>" +
      "<td><span class='pill " + status.pillClass + "'>" + escapeReportHtml(status.label) + "</span></td>" +
      "<td class='small text-muted-custom order-history-detail' title='" + escapeReportHtml(detail || "") + "'>" +
        escapeReportHtml(detail || "—") + "</td>" +
      "</tr>";
  }

  static formatDate(isoText) {
    var date = new Date(isoText);
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) + ", " +
      date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  // Fractional orders carry a dollar amount in the quantity field.
  static formatQuantity(order) {
    var quantity = parseFloat(order.quantity);
    if (order.order_category === "fractional") return OrderHistoryView.formatMoney(quantity);
    return quantity.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }

  static formatMoney(value) {
    if (value === null || value === undefined || value === "") return "—";
    return "$" + Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

// Switches between report tabs and runs the selected report.
class ReportsPage {
  constructor() {
    this.dateRange = new ReportDateRange();
    this.taxReport = new TaxReportView();
    this.pnlReport = new PnlReportView();
    this.orderHistory = new OrderHistoryView();
    this.selectedType = "PNL";
  }

  start() {
    this.dateRange.setDefault();
    $("#reportTabs").on("click", ".report-nav-item", (event) => this.selectTab($(event.currentTarget).data("report")));
    $("#reportDateRangeForm").on("submit", (event) => {
      event.preventDefault();
      this.run();
    });
    this.selectTab(ReportsPage.tabFromUrl());
  }

  static tabFromUrl() {
    var tab = new URLSearchParams(window.location.search).get("tab") || "";
    return REPORT_TAB_QUERY_VALUES[tab.toLowerCase()] || "PNL";
  }

  selectTab(reportType) {
    var isOrderHistory = reportType === "ORDERS";
    this.selectedType = reportType;
    $("#reportTabs .report-nav-item").removeClass("active").attr("aria-selected", "false");
    $('#reportTabs .report-nav-item[data-report="' + reportType + '"]').addClass("active").attr("aria-selected", "true");
    $("#reportTitle").text(REPORT_TYPES[reportType].title);
    $("#reportDescription").text(REPORT_TYPES[reportType].description);
    $("#runReportBtn").text(isOrderHistory ? "Show Orders" : "Run Report");
    this.showPanelFor(reportType);
    $("#reportErrorAlert").addClass("d-none");
    if (isOrderHistory) this.run();
    else this.resetReport(reportType);
  }

  showPanelFor(reportType) {
    $("#pnlReportPanel").toggleClass("d-none", reportType !== "PNL");
    $("#taxReportPanel").toggleClass("d-none", reportType !== "TAX");
    $("#orderHistoryPanel").toggleClass("d-none", reportType !== "ORDERS");
  }

  resetReport(reportType) {
    if (reportType === "PNL") this.pnlReport.reset();
    else this.taxReport.reset();
  }

  requestFor(reportType) {
    if (reportType === "ORDERS") return this.orderHistory.load(this.dateRange.instantQuery());
    if (reportType === "PNL") return this.pnlReport.run(this.dateRange.dateQuery());
    return this.taxReport.run(this.dateRange.dateQuery());
  }

  run() {
    var $button = $("#runReportBtn").prop("disabled", true);
    $("#reportErrorAlert").addClass("d-none");
    this.requestFor(this.selectedType)
      .fail((jqXHR) => $("#reportErrorAlert").text(extractApiErrorMessage(jqXHR)).removeClass("d-none"))
      .always(() => $button.prop("disabled", false));
  }
}

$(function () {
  if (!requireSignedInUser()) {
    return;
  }
  new ReportsPage().start();
});
